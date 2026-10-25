from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .config import DATABASE_URL


class Base(DeclarativeBase):
    pass


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    topic: Mapped[str] = mapped_column(String(100), default="General")
    secondary_topics: Mapped[str] = mapped_column(String(255), default="")
    difficulty: Mapped[str] = mapped_column(String(25), default="Medium")
    date_solved: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    time_complexity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    space_complexity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(25), default="Solved")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    revision_events: Mapped[List["RevisionEvent"]] = relationship(back_populates="problem")


class RevisionEvent(Base):
    __tablename__ = "revision_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id"), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_attempt_date: Mapped[date] = mapped_column(Date, nullable=False)
    recall_rating: Mapped[str] = mapped_column(String(25), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    problem: Mapped[Problem] = relationship(back_populates="revision_events")


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)


class GameProfile(Base):
    __tablename__ = "game_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_reviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    achievements: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)


_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if _sqlite else {},
    pool_pre_ping=not _sqlite,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    if engine.url.drivername.startswith("sqlite") and engine.url.database not in (
        None,
        "",
        ":memory:",
    ):
        Path(engine.url.database).expanduser().resolve().parent.mkdir(
            parents=True, exist_ok=True
        )
    Base.metadata.create_all(bind=engine)


def ensure_game_profile(db: Session) -> GameProfile:
    profile = db.query(GameProfile).first()
    if profile is None:
        profile = GameProfile()
        db.add(profile)
        db.flush()
    return profile


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize_url(raw_url: Optional[str]) -> Optional[str]:
    if not raw_url:
        return None
    value = raw_url.strip()
    if not value:
        return None
    return value.rstrip("/")


def default_settings() -> Dict[str, str]:
    return {
        "revision_intervals": "1,3,7,14",
        "daily_revision_target": "5",
        "preferred_language": "Python",
        "ollama_model": "gemma3:4b",
    }


def ensure_default_settings(db: Session) -> Dict[str, str]:
    settings = default_settings()
    for key, value in settings.items():
        existing = db.query(Settings).filter(Settings.key == key).first()
        if existing is None:
            db.add(Settings(key=key, value=str(value)))
    db.commit()
    return settings


def get_settings_map(db: Session) -> Dict[str, str]:
    rows = db.query(Settings).all()
    settings = default_settings()
    for row in rows:
        settings[row.key] = row.value
    return settings


def seed_demo_data(db: Session) -> None:
    if db.query(Problem).count() > 0:
        return

    solved_dates = [
        date.today() - timedelta(days=4),
        date.today() - timedelta(days=10),
        date.today() - timedelta(days=20),
        date.today() - timedelta(days=32),
        date.today() - timedelta(days=40),
    ]

    problems = [
        Problem(
            title="Two Sum",
            url="https://leetcode.com/problems/two-sum/",
            topic="Hashing",
            secondary_topics="Arrays",
            difficulty="Easy",
            date_solved=solved_dates[0],
            notes="Use a hash map to store previous values and indexes.",
            time_complexity="O(n)",
            space_complexity="O(n)",
            status="Solved",
        ),
        Problem(
            title="Best Time to Buy and Sell Stock",
            url="https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
            topic="Arrays",
            secondary_topics="Greedy",
            difficulty="Easy",
            date_solved=solved_dates[1],
            notes="Track the minimum price and best profit so far.",
            time_complexity="O(n)",
            space_complexity="O(1)",
            status="Solved",
        ),
        Problem(
            title="Longest Substring Without Repeating Characters",
            url="https://leetcode.com/problems/longest-substring-without-repeating-characters/",
            topic="Sliding Window",
            secondary_topics="Strings",
            difficulty="Medium",
            date_solved=solved_dates[2],
            notes="Use a sliding window with a set to track seen characters.",
            time_complexity="O(n)",
            space_complexity="O(k)",
            status="Solved",
        ),
        Problem(
            title="Merge Intervals",
            url="https://leetcode.com/problems/merge-intervals/",
            topic="Intervals",
            secondary_topics="Sorting",
            difficulty="Medium",
            date_solved=solved_dates[3],
            notes="Sort intervals by start and merge overlapping ranges.",
            time_complexity="O(n log n)",
            space_complexity="O(n)",
            status="Needs Practice",
        ),
        Problem(
            title="Binary Tree Level Order Traversal",
            url="https://leetcode.com/problems/binary-tree-level-order-traversal/",
            topic="Trees",
            secondary_topics="Queues",
            difficulty="Medium",
            date_solved=solved_dates[4],
            notes="Use BFS with a queue and process each level.",
            time_complexity="O(n)",
            space_complexity="O(w)",
            status="Solved",
        ),
    ]

    db.add_all(problems)
    db.commit()

    for problem in problems:
        db.add(
            RevisionEvent(
                problem_id=problem.id,
                scheduled_date=problem.date_solved + timedelta(days=1),
                actual_attempt_date=problem.date_solved + timedelta(days=1),
                recall_rating="Easy" if problem.difficulty == "Easy" else "Struggled",
                notes="Initial revision attempt.",
                next_due_date=problem.date_solved + timedelta(days=3),
            )
        )
    db.commit()
