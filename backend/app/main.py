from __future__ import annotations

import io
import hmac
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .ai_service import generate_ai_response, get_ollama_status
from .auth import (
    ApiAuthMiddleware,
    RECODE_AUTH_PASSWORD,
    RECODE_REQUIRE_AUTH,
    SESSION_COOKIE,
    clear_session_cookie,
    create_session_token,
    is_valid_session,
    set_session_cookie,
)
from .config import CORS_ORIGINS, OLLAMA_BASE_URL, OLLAMA_MODEL, RECODE_SEED_DEMO_DATA
from .db import (
    GameProfile,
    Problem,
    RevisionEvent,
    Settings,
    SessionLocal,
    ensure_game_profile,
    ensure_default_settings,
    get_db,
    get_settings_map,
    init_db,
    normalize_url,
    seed_demo_data,
)

app = FastAPI(title="ReCode API", version="0.1.0")
REVISION_XP = 20
ACHIEVEMENT_MILESTONES = (
    (1, "first-recall", "First Recall", "Completed your first revision quest."),
    (5, "memory-builder", "Memory Builder", "Completed five revision quests."),
    (25, "recall-keeper", "Recall Keeper", "Completed twenty-five revision quests."),
)

app.add_middleware(ApiAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProblemCreate(BaseModel):
    title: str
    url: Optional[str] = None
    topic: str = "General"
    secondary_topics: str = ""
    difficulty: str = "Medium"
    date_solved: Optional[str] = None
    notes: Optional[str] = None
    time_complexity: Optional[str] = None
    space_complexity: Optional[str] = None
    status: str = "Solved"


class ProblemPatch(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    topic: Optional[str] = None
    secondary_topics: Optional[str] = None
    difficulty: Optional[str] = None
    date_solved: Optional[str] = None
    notes: Optional[str] = None
    time_complexity: Optional[str] = None
    space_complexity: Optional[str] = None
    status: Optional[str] = None


class RevisionCompleteRequest(BaseModel):
    rating: str = Field(..., pattern="^(Easy|Struggled|Forgot)$")
    notes: Optional[str] = None


class ImportCommitRequest(BaseModel):
    rows: List[Dict[str, Any]]


class LoginRequest(BaseModel):
    password: str


@app.on_event("startup")
def startup_event() -> None:
    init_db()
    db = SessionLocal()
    try:
        ensure_default_settings(db)
        if RECODE_SEED_DEMO_DATA:
            seed_demo_data(db)
    finally:
        db.close()


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/session")
def auth_session(request: Request) -> Dict[str, bool]:
    if not RECODE_REQUIRE_AUTH:
        return {"authenticated": True, "auth_required": False}
    return {
        "authenticated": is_valid_session(request.cookies.get(SESSION_COOKIE)),
        "auth_required": True,
    }


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response) -> Dict[str, bool]:
    if not RECODE_REQUIRE_AUTH:
        return {"authenticated": True}
    if not hmac.compare_digest(
        payload.password.encode("utf-8"), RECODE_AUTH_PASSWORD.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="The password is incorrect.")
    set_session_cookie(response, create_session_token())
    return {"authenticated": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response) -> Dict[str, bool]:
    clear_session_cookie(response)
    return {"authenticated": False}


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return {
        "settings": get_settings_map(db),
        "ai_status": get_ollama_status(),
    }


@app.get("/api/export")
def export_data(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = ensure_game_profile(db)
    db.commit()
    problems = [serialize_problem(problem) for problem in db.query(Problem).order_by(Problem.id.asc()).all()]
    revision_events = [
        serialize_revision_event(event)
        for event in db.query(RevisionEvent).order_by(RevisionEvent.id.asc()).all()
    ]
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "problems": problems,
        "revision_events": revision_events,
        "game_profile": serialize_game_profile(profile),
    }


@app.get("/api/game/profile")
def game_profile(db: Session = Depends(get_db)) -> Dict[str, Any]:
    profile = ensure_game_profile(db)
    db.commit()
    return serialize_game_profile(profile)


@app.patch("/api/settings")
def patch_settings(payload: Dict[str, str], db: Session = Depends(get_db)) -> Dict[str, Any]:
    for key, value in payload.items():
        row = db.query(Settings).filter(Settings.key == key).first()
        if row is None:
            db.add(Settings(key=key, value=str(value)))
        else:
            row.value = str(value)
    db.commit()
    return {"settings": get_settings_map(db)}


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)) -> Dict[str, Any]:
    problems = db.query(Problem).all()
    total = len(problems)
    solved_count = sum(1 for p in problems if p.status == "Solved")
    due_today = 0
    overdue = 0
    for problem in problems:
        next_due = latest_due_date_for_problem(db, problem.id)
        if next_due is None:
            if problem.status == "Solved" and problem.date_solved is not None:
                due_today += 1
            continue
        if next_due < date.today():
            overdue += 1
        elif next_due == date.today():
            due_today += 1

    completion_rate = round((solved_count / total) * 100, 1) if total else 0.0
    topic_breakdown = build_topic_stats(db)
    difficulty_breakdown = build_difficulty_stats(db)
    upcoming = build_revision_snapshot(db)["upcoming"]
    recent_activity = build_recent_activity(db)
    weekly_review_activity = build_weekly_review_activity(db)
    return {
        "total_problems_solved": solved_count,
        "problems_due_today": due_today,
        "overdue_revisions": overdue,
        "revision_completion_rate": completion_rate,
        "topic_breakdown": topic_breakdown,
        "difficulty_breakdown": difficulty_breakdown,
        "upcoming_revision_schedule": upcoming[:5],
        "recent_activity": recent_activity,
        "weekly_review_activity": weekly_review_activity,
        "empty_state": total == 0,
    }


@app.get("/api/problems")
def list_problems(
    search: Optional[str] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    query = db.query(Problem)
    if search:
        needle = f"%{search.lower()}%"
        query = query.filter(or_(func.lower(Problem.title).like(needle), func.lower(Problem.topic).like(needle), func.lower(Problem.url).like(needle)))
    if topic:
        query = query.filter(Problem.topic == topic)
    if difficulty:
        query = query.filter(Problem.difficulty == difficulty)
    if status:
        query = query.filter(Problem.status == status)

    rows = query.order_by(Problem.date_solved.desc().nullslast(), Problem.id.desc()).all()
    return [serialize_problem(problem) for problem in rows]


@app.post("/api/problems")
def create_problem(payload: ProblemCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Problem title is required.")

    normalized_url = normalize_url(payload.url)
    if normalized_url:
        exists = db.query(Problem).filter(func.lower(Problem.url) == normalized_url.lower()).first()
        if exists:
            raise HTTPException(status_code=409, detail="A matching problem already exists in the bank.")

    problem = Problem(
        title=payload.title.strip(),
        url=normalized_url,
        topic=payload.topic.strip() or "General",
        secondary_topics=payload.secondary_topics.strip(),
        difficulty=payload.difficulty.strip() or "Medium",
        date_solved=parse_date(payload.date_solved) or date.today(),
        notes=payload.notes,
        time_complexity=payload.time_complexity,
        space_complexity=payload.space_complexity,
        status=payload.status.strip() or "Solved",
    )
    db.add(problem)
    db.commit()
    db.refresh(problem)
    return serialize_problem(problem)


@app.get("/api/problems/{problem_id}")
def get_problem(problem_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    problem = db.query(Problem).filter(Problem.id == problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found.")
    return serialize_problem(problem)


@app.patch("/api/problems/{problem_id}")
def update_problem(problem_id: int, patch: ProblemPatch, db: Session = Depends(get_db)) -> Dict[str, Any]:
    problem = db.query(Problem).filter(Problem.id == problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found.")
    payload = patch.model_dump(exclude_unset=True)
    for key, value in payload.items():
        if value is None:
            continue
        if key == "date_solved":
            setattr(problem, key, parse_date(value))
        else:
            setattr(problem, key, value)
    db.commit()
    db.refresh(problem)
    return serialize_problem(problem)


@app.delete("/api/problems/{problem_id}")
def delete_problem(problem_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    problem = db.query(Problem).filter(Problem.id == problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found.")
    db.delete(problem)
    db.commit()
    return {"status": "deleted"}


@app.post("/api/import/preview")
async def preview_import(file: UploadFile = File(...), db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="A file is required.")
    ext = (file.filename or "").lower()
    if not (ext.endswith(".csv") or ext.endswith(".xlsx") or ext.endswith(".xls")):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are supported.")

    content = await file.read()
    try:
        if ext.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse the uploaded file: {exc}") from exc

    preview_rows: List[Dict[str, Any]] = []
    for index, row in df.iterrows():
        mapped = normalize_row_fields(row)
        preview_rows.append({"row_index": index + 1, **mapped})

    return {
        "filename": file.filename,
        "row_count": len(df.index),
        "preview": preview_rows[:10],
        "columns": list(df.columns),
    }


@app.post("/api/import/commit")
def commit_import(payload: ImportCommitRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    added = 0
    skipped = 0
    invalid = 0
    for item in payload.rows:
        row = normalize_row_fields(item)
        title = (row.get("title") or "").strip()
        if not title:
            invalid += 1
            continue
        url = normalize_url(row.get("url"))
        if url:
            duplicate = db.query(Problem).filter(func.lower(Problem.url) == url.lower()).first()
            if duplicate:
                skipped += 1
                continue
        problem = Problem(
            title=title,
            url=url,
            topic=(row.get("topic") or "General").strip() or "General",
            secondary_topics=(row.get("secondary_topics") or "").strip(),
            difficulty=(row.get("difficulty") or "Medium").strip() or "Medium",
            date_solved=parse_date(row.get("date_solved")),
            notes=row.get("notes"),
            time_complexity=row.get("time_complexity"),
            space_complexity=row.get("space_complexity"),
            status=(row.get("status") or "Solved").strip() or "Solved",
        )
        db.add(problem)
        added += 1
    db.commit()
    return {"added": added, "skipped": skipped, "invalid": invalid}


@app.get("/api/revision")
def revision_summary(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return build_revision_snapshot(db)


@app.post("/api/revision/{problem_id}/complete")
def complete_revision(problem_id: int, payload: RevisionCompleteRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    problem = db.query(Problem).filter(Problem.id == problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found.")
    actual_date = date.today()
    existing = db.query(RevisionEvent).filter(RevisionEvent.problem_id == problem_id, RevisionEvent.actual_attempt_date == actual_date).first()
    if existing:
        raise HTTPException(status_code=409, detail="This review was already completed today.")

    scheduled_date = latest_due_date_for_problem(db, problem_id) or (problem.date_solved or date.today())
    intervals = load_intervals(db)
    stage = db.query(RevisionEvent).filter(RevisionEvent.problem_id == problem_id).count()
    next_due = actual_date + timedelta(days=determine_gap(payload.rating, stage, intervals))

    event = RevisionEvent(
        problem_id=problem.id,
        scheduled_date=scheduled_date,
        actual_attempt_date=actual_date,
        recall_rating=payload.rating,
        notes=payload.notes,
        next_due_date=next_due,
    )
    db.add(event)
    profile = ensure_game_profile(db)
    profile.xp += REVISION_XP
    profile.completed_reviews += 1

    if profile.last_active_date != actual_date:
        profile.current_streak = (
            profile.current_streak + 1
            if profile.last_active_date == actual_date - timedelta(days=1)
            else 1
        )
        profile.last_active_date = actual_date
    profile.best_streak = max(profile.best_streak, profile.current_streak)

    achievements = list(profile.achievements or [])
    existing_achievement_ids = {item["id"] for item in achievements}
    for threshold, achievement_id, title, description in ACHIEVEMENT_MILESTONES:
        if profile.completed_reviews >= threshold and achievement_id not in existing_achievement_ids:
            achievements.append({
                "id": achievement_id,
                "title": title,
                "description": description,
                "earned_at": actual_date.isoformat(),
            })
    if profile.current_streak >= 3 and "steady-explorer" not in existing_achievement_ids:
        achievements.append({
            "id": "steady-explorer",
            "title": "Steady Explorer",
            "description": "Reviewed problems on three consecutive days.",
            "earned_at": actual_date.isoformat(),
        })
    profile.achievements = achievements
    db.commit()

    return {
        "status": "completed",
        "problem_id": problem.id,
        "rating": payload.rating,
        "next_due_date": next_due.isoformat(),
        "xp_earned": REVISION_XP,
        "game_profile": serialize_game_profile(profile),
    }


@app.get("/api/topics")
def topics(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return {"stats": build_topic_stats(db), "info": "Topic totals can overlap and should not be added together to infer unique solved problems."}


@app.get("/api/coach/status")
def coach_status() -> Dict[str, Any]:
    return get_ollama_status()


@app.post("/api/coach")
def coach_chat(payload: Dict[str, Any], db: Session = Depends(get_db)) -> Dict[str, Any]:
    mode = str(payload.get("mode") or "solve").lower()
    user_prompt = str(payload.get("prompt") or "").strip() or "Teach me this problem step by step."
    problem_id = payload.get("problem_id")
    problem_data = None
    if problem_id:
        problem = db.query(Problem).filter(Problem.id == int(problem_id)).first()
        if problem is not None:
            problem_data = serialize_problem(problem)

    status = get_ollama_status()
    if not status["available"]:
        raise HTTPException(status_code=503, detail="Ollama is unavailable. Install Ollama and pull gemma3:4b to enable local AI coaching.")

    try:
        reply = generate_ai_response(mode, user_prompt, problem_data)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "mode": mode,
        "response": reply,
        "problem": problem_data,
    }


def serialize_problem(problem: Problem) -> Dict[str, Any]:
    return {
        "id": problem.id,
        "title": problem.title,
        "url": problem.url,
        "topic": problem.topic,
        "secondary_topics": problem.secondary_topics,
        "difficulty": problem.difficulty,
        "date_solved": problem.date_solved.isoformat() if problem.date_solved else None,
        "notes": problem.notes,
        "time_complexity": problem.time_complexity,
        "space_complexity": problem.space_complexity,
        "status": problem.status,
        "next_due_date": latest_due_date_for_problem(SessionLocal(), problem.id) or None,
    }


def serialize_game_profile(profile: GameProfile) -> Dict[str, Any]:
    current_streak = profile.current_streak
    if profile.last_active_date is None or profile.last_active_date < date.today() - timedelta(days=1):
        current_streak = 0
    return {
        "xp": profile.xp,
        "level": profile.xp // 100 + 1,
        "level_xp": profile.xp % 100,
        "xp_to_next_level": 100 - profile.xp % 100,
        "completed_reviews": profile.completed_reviews,
        "current_streak": current_streak,
        "best_streak": profile.best_streak,
        "last_active_date": profile.last_active_date.isoformat() if profile.last_active_date else None,
        "achievements": profile.achievements or [],
    }


def serialize_revision_event(event: RevisionEvent) -> Dict[str, Any]:
    return {
        "id": event.id,
        "problem_id": event.problem_id,
        "scheduled_date": event.scheduled_date.isoformat(),
        "actual_attempt_date": event.actual_attempt_date.isoformat(),
        "recall_rating": event.recall_rating,
        "notes": event.notes,
        "next_due_date": event.next_due_date.isoformat() if event.next_due_date else None,
        "created_at": event.created_at.isoformat(),
    }


def load_intervals(db: Session) -> List[int]:
    settings = get_settings_map(db)
    raw = settings.get("revision_intervals", "1,3,7,14")
    values = []
    for item in raw.split(","):
        try:
            values.append(int(item.strip()))
        except ValueError:
            continue
    if not values:
        return [1, 3, 7, 14]
    return values


def determine_gap(rating: str, stage_index: int, intervals: List[int]) -> int:
    if rating == "Easy":
        return intervals[min(stage_index, len(intervals) - 1)]
    if rating == "Struggled":
        return 1
    return 1


def parse_date(value: Optional[str]) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    for candidate in ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"]:
        try:
            return datetime.strptime(str(value), candidate).date()
        except ValueError:
            continue
    return None


def normalize_row_fields(row: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {}
    raw = {str(key).strip().lower(): value for key, value in row.items() if key is not None}
    field_map = {
        "title": ["title", "problem", "problem_title", "name"],
        "url": ["url", "leetcode_url", "link", "problem_url"],
        "topic": ["topic", "category", "tag", "primary_topic"],
        "secondary_topics": ["secondary_topics", "secondary_topic", "tags", "topics"],
        "difficulty": ["difficulty", "level", "complexity"],
        "date_solved": ["date_solved", "solved_date", "date", "completed_on"],
        "notes": ["notes", "approach", "personal_notes", "summary"],
        "time_complexity": ["time_complexity", "time", "tc"],
        "space_complexity": ["space_complexity", "space", "sc"],
        "status": ["status", "state"],
    }
    for canonical, aliases in field_map.items():
        for alias in aliases:
            if alias in raw:
                normalized[canonical] = raw[alias]
                break
    if "secondary_topics" not in normalized:
        normalized["secondary_topics"] = ""
    if "difficulty" not in normalized:
        normalized["difficulty"] = "Medium"
    if "topic" not in normalized:
        normalized["topic"] = "General"
    if "status" not in normalized:
        normalized["status"] = "Solved"
    return normalized


def build_topic_stats(db: Session) -> List[Dict[str, Any]]:
    stats: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"solved": 0, "needs_practice": 0, "total": 0, "struggles": 0, "forgotten": 0, "easy": 0, "medium": 0, "hard": 0}
    )
    problems = db.query(Problem).all()
    for problem in problems:
        tags = [problem.topic]
        if problem.secondary_topics:
            tags.extend([tag.strip() for tag in problem.secondary_topics.split(",") if tag.strip()])
        for tag in tags:
            entry = stats[tag]
            entry["total"] += 1
            if problem.status == "Solved":
                entry["solved"] += 1
            if problem.status == "Needs Practice":
                entry["needs_practice"] += 1
            if problem.difficulty == "Easy":
                entry["easy"] += 1
            elif problem.difficulty == "Medium":
                entry["medium"] += 1
            elif problem.difficulty == "Hard":
                entry["hard"] += 1

    events = db.query(RevisionEvent).all()
    for event in events:
        if event.problem is None:
            continue
        labels = [event.problem.topic]
        if event.problem.secondary_topics:
            labels.extend([tag.strip() for tag in event.problem.secondary_topics.split(",") if tag.strip()])
        for tag in labels:
            entry = stats[tag]
            if event.recall_rating == "Struggled":
                entry["struggles"] += 1
            elif event.recall_rating == "Forgot":
                entry["forgotten"] += 1

    return [
        {"topic": topic, **values}
        for topic, values in sorted(stats.items())
    ]


def build_difficulty_stats(db: Session) -> Dict[str, int]:
    values = {"Easy": 0, "Medium": 0, "Hard": 0}
    for problem in db.query(Problem).all():
        values[problem.difficulty] = values.get(problem.difficulty, 0) + 1
    return values


def build_recent_activity(db: Session) -> List[Dict[str, str]]:
    activity = []
    for problem in db.query(Problem).order_by(Problem.updated_at.desc()).limit(5).all():
        activity.append({
            "title": problem.title,
            "detail": f"{problem.topic} • {problem.difficulty}",
            "time": problem.updated_at.strftime("%b %d, %Y"),
        })
    return activity


def build_weekly_review_activity(db: Session) -> List[Dict[str, Any]]:
    today = date.today()
    start_date = today - timedelta(days=6)
    counts: Dict[date, int] = defaultdict(int)
    events = db.query(RevisionEvent).filter(
        RevisionEvent.actual_attempt_date >= start_date,
        RevisionEvent.actual_attempt_date <= today,
    ).all()
    for event in events:
        counts[event.actual_attempt_date] += 1
    return [
        {
            "date": (start_date + timedelta(days=offset)).isoformat(),
            "day": (start_date + timedelta(days=offset)).strftime("%a"),
            "reviews": counts[start_date + timedelta(days=offset)],
        }
        for offset in range(7)
    ]


def build_revision_snapshot(db: Session) -> Dict[str, List[Dict[str, Any]]]:
    problems = db.query(Problem).all()
    due_today: List[Dict[str, Any]] = []
    overdue: List[Dict[str, Any]] = []
    upcoming: List[Dict[str, Any]] = []
    completed_today: List[Dict[str, Any]] = []
    today = date.today()

    for problem in problems:
        last_event = db.query(RevisionEvent).filter(RevisionEvent.problem_id == problem.id).order_by(RevisionEvent.actual_attempt_date.desc()).first()
        latest_due = latest_due_date_for_problem(db, problem.id)
        if latest_due is None:
            if problem.status != "Solved" and last_event is None:
                continue
            latest_due = problem.date_solved + timedelta(days=1) if problem.date_solved else today
        card = {
            "id": problem.id,
            "title": problem.title,
            "topic": problem.topic,
            "secondary_topics": problem.secondary_topics,
            "topics": [problem.topic, *[tag.strip() for tag in problem.secondary_topics.split(",") if tag.strip()]],
            "difficulty": problem.difficulty,
            "last_revision": last_event.actual_attempt_date.isoformat() if last_event else (problem.date_solved.isoformat() if problem.date_solved else "N/A"),
            "next_due_date": latest_due.isoformat(),
            "url": problem.url,
            "notes": problem.notes,
            "status": problem.status,
        }
        if last_event and last_event.actual_attempt_date == today:
            completed_today.append(card)
            if latest_due > today:
                upcoming.append(card)
        elif latest_due < today:
            overdue.append(card)
        elif latest_due == today:
            due_today.append(card)
        else:
            upcoming.append(card)

    return {
        "due_today": due_today,
        "overdue": overdue,
        "upcoming": sorted(upcoming, key=lambda item: item["next_due_date"]),
        "completed_today": completed_today,
    }


def latest_due_date_for_problem(db: Session, problem_id: int) -> Optional[date]:
    latest_event = db.query(RevisionEvent).filter(RevisionEvent.problem_id == problem_id).order_by(RevisionEvent.created_at.desc()).first()
    if latest_event and latest_event.next_due_date is not None:
        return latest_event.next_due_date
    problem = db.query(Problem).filter(Problem.id == problem_id).first()
    if problem and problem.status == "Solved" and problem.date_solved:
        return problem.date_solved + timedelta(days=1)
    return None
