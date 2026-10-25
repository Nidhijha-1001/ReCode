import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/+$/, '')

type PageKey = 'dashboard' | 'solve' | 'revision' | 'bank' | 'topics' | 'coach' | 'settings'

type TopicStat = {
  topic: string
  solved: number
  needs_practice: number
  total: number
  struggles: number
  forgotten: number
  easy: number
  medium: number
  hard: number
}

type Problem = {
  id: number
  title: string
  url?: string
  topic: string
  secondary_topics?: string
  difficulty: string
  date_solved?: string
  notes?: string
  time_complexity?: string
  space_complexity?: string
  status: string
  next_due_date?: string
}

type RevisionSnapshot = {
  due_today: Problem[]
  overdue: Problem[]
  upcoming: Problem[]
  completed_today: Problem[]
}

function problemRevisionState(problemId: number, revision: RevisionSnapshot) {
  if (revision.completed_today.some((problem) => problem.id === problemId)) return 'completed'
  if (revision.overdue.some((problem) => problem.id === problemId)) return 'overdue'
  if (revision.due_today.some((problem) => problem.id === problemId)) return 'due'
  if (revision.upcoming.some((problem) => problem.id === problemId)) return 'upcoming'
  return 'unscheduled'
}

type GameAchievement = {
  id: string
  title: string
  description: string
  earned_at: string
}

type GameProfile = {
  xp: number
  level: number
  level_xp: number
  xp_to_next_level: number
  completed_reviews: number
  current_streak: number
  best_streak: number
  last_active_date: string | null
  achievements: GameAchievement[]
}

const emptyGameProfile: GameProfile = {
  xp: 0,
  level: 1,
  level_xp: 0,
  xp_to_next_level: 100,
  completed_reviews: 0,
  current_streak: 0,
  best_streak: 0,
  last_active_date: null,
  achievements: [],
}

const navItems: Array<{ key: PageKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'solve', label: 'Solve' },
  { key: 'revision', label: 'Revision' },
  { key: 'bank', label: 'Problem Bank' },
  { key: 'topics', label: 'Topics & Progress' },
  { key: 'coach', label: 'AI DSA Coach' },
  { key: 'settings', label: 'Settings' },
]

const coachQuickActions = [
  { label: 'Give me a hint', mode: 'hint', prompt: 'Give me a small hint without revealing the full solution. Focus on the core observation and how to approach this problem.' },
  { label: 'Explain the optimal approach', mode: 'solve', prompt: 'Explain the optimal approach for this problem in clear steps: the insight, algorithm, and tradeoffs.' },
  { label: 'Analyze complexity', mode: 'solve', prompt: 'Analyze the time and space complexity of the best approach and explain the bottlenecks and edge cases.' },
  { label: 'Quiz me', mode: 'revise', prompt: 'Quiz me on this problem. Ask me one probing question at a time and help me reason through the solution.' },
]

const defaultForm = {
  title: '',
  url: '',
  topic: 'Arrays',
  secondary_topics: '',
  difficulty: 'Medium',
  date_solved: new Date().toISOString().slice(0, 10),
  notes: '',
  time_complexity: '',
  space_complexity: '',
  status: 'Solved',
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })
  if (!res.ok) {
    const body = await res.text()
    let message = body || res.statusText || 'Request failed'
    try {
      const payload = JSON.parse(body) as { detail?: unknown; message?: unknown }
      if (typeof payload.detail === 'string') message = payload.detail
      else if (typeof payload.message === 'string') message = payload.message
    } catch {
      // Keep non-JSON error responses visible to the caller.
    }
    throw new Error(`${res.status} ${res.statusText}: ${message} (${path})`)
  }
  return res.json() as Promise<T>
}

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const [dashboard, setDashboard] = useState<any>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [revision, setRevision] = useState<RevisionSnapshot>({
    due_today: [],
    overdue: [],
    upcoming: [],
    completed_today: [],
  })
  const [topics, setTopics] = useState<TopicStat[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [aiStatus, setAiStatus] = useState({ available: false, message: 'Checking AI availability…' })
  const [problemForm, setProblemForm] = useState(defaultForm)
  const [importRows, setImportRows] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [coachMode, setCoachMode] = useState('solve')
  const [coachPrompt, setCoachPrompt] = useState('Explain this problem step by step and share the key intuition.')
  const [coachResponse, setCoachResponse] = useState('')
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [ratingMap, setRatingMap] = useState<Record<number, string>>({})
  const [gameProfile, setGameProfile] = useState<GameProfile>(emptyGameProfile)
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking')
  const [authRequired, setAuthRequired] = useState(false)
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authCheckError, setAuthCheckError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [gameToast, setGameToast] = useState('')
  const [coachError, setCoachError] = useState('')
  const [coachLoading, setCoachLoading] = useState(false)
  const [completionLoadingId, setCompletionLoadingId] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [problemFilter, setProblemFilter] = useState('all')
  const [topicFilter, setTopicFilter] = useState('all')
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [problemSort, setProblemSort] = useState('recent')
  const [selectedTopic, setSelectedTopic] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const loadData = async () => {
    try {
      const [dash, problemList, revisionData, topicData, settingsData, profile] = await Promise.all([
        apiFetch<any>('/dashboard'),
        apiFetch<Problem[]>('/problems'),
        apiFetch<RevisionSnapshot>('/revision'),
        apiFetch<{ stats: TopicStat[] }>('/topics'),
        apiFetch<{ settings: Record<string, string>; ai_status: any }>('/settings'),
        apiFetch<GameProfile>('/game/profile'),
      ])
      setDashboard(dash)
      setProblems(problemList)
      setRevision(revisionData)
      setTopics(topicData.stats)
      setSettings(settingsData.settings)
      setAiStatus(settingsData.ai_status)
      setGameProfile(profile)
      setLoadError('')
      setSelectedProblemId((current) => (
        current !== null && problemList.some((problem) => problem.id === current)
          ? current
          : problemList[0]?.id ?? null
      ))
    } catch (error) {
      console.error('Failed to fetch app data', error)
      setLoadError(error instanceof Error ? error.message : 'Could not load game data.')
    }
  }

  useEffect(() => {
    let active = true
    apiFetch<{ authenticated: boolean; auth_required: boolean }>('/auth/session')
      .then((session) => {
        if (!active) return
        setAuthRequired(session.auth_required)
        if (!session.authenticated) {
          setAuthState('unauthenticated')
          return
        }
        setAuthState('authenticated')
        void loadData()
      })
      .catch((error) => {
        if (!active) return
        setAuthCheckError(error instanceof Error ? error.message : 'Could not connect to ReCode.')
        setAuthState('error')
      })
    return () => { active = false }
  }, [])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      await apiFetch<{ authenticated: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: authPassword }),
      })
      setAuthPassword('')
      setAuthState('authenticated')
      await loadData()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
      setAuthState('unauthenticated')
      setAuthPassword('')
      setPaused(false)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  useEffect(() => {
    const shortcutPages: Record<string, PageKey> = {
      i: 'bank',
      b: 'bank',
      c: 'solve',
      q: 'revision',
      m: 'topics',
      a: 'coach',
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (event.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false)
        } else {
          setPaused((isPaused) => !isPaused)
        }
        return
      }
      if (paused || showShortcuts) return
      if (target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )) return
      if (event.key === '?') {
        setShowShortcuts((visible) => !visible)
        return
      }
      const page = shortcutPages[event.key.toLowerCase()]
      if (page && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setActivePage(page)
      }
      if (event.key === '/' && activePage === 'bank') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePage, paused, showShortcuts])

  const visibleProblems = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = problems.filter((problem) => {
      const haystack = `${problem.title} ${problem.topic} ${problem.secondary_topics ?? ''} ${problem.url ?? ''}`.toLowerCase()
      const matchesQuery = !query || haystack.includes(query)
      const matchesTopic = topicFilter === 'all' || problem.topic === topicFilter || problem.secondary_topics?.split(',').map((topic) => topic.trim()).includes(topicFilter)
      const matchesDifficulty = difficultyFilter === 'all' || problem.difficulty.toLowerCase() === difficultyFilter
      const state = problemRevisionState(problem.id, revision)
      const matchesState = problemFilter === 'all' || state === problemFilter
      return matchesQuery && matchesTopic && matchesDifficulty && matchesState
    })
    return filtered.sort((left, right) => {
      if (problemSort === 'title') return left.title.localeCompare(right.title)
      if (problemSort === 'topic') return left.topic.localeCompare(right.topic) || left.title.localeCompare(right.title)
      if (problemSort === 'oldest') return (left.date_solved ?? '').localeCompare(right.date_solved ?? '')
      return (right.date_solved ?? '').localeCompare(left.date_solved ?? '')
    })
  }, [problems, search, topicFilter, difficultyFilter, problemFilter, problemSort, revision])

  const selectedProblem = problems.find((problem) => problem.id === selectedProblemId) ?? problems[0]

  const handleProblemSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const createdProblem = await apiFetch<Problem>('/problems', {
        method: 'POST',
        body: JSON.stringify(problemForm),
      })
      setSelectedProblemId(createdProblem.id)
      setProblemForm(defaultForm)
      await loadData()
      setGameToast(problemForm.status === 'Solved'
        ? `${createdProblem.title} added · first review scheduled`
        : `${createdProblem.title} added to inventory`)
      window.setTimeout(() => setGameToast(''), 4200)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not save problem.')
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const data = await apiFetch<{ preview: any[] }>('/import/preview', {
        method: 'POST',
        body: formData,
      })
      setImportRows(data.preview)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Import preview failed.')
    }
  }

  const handleImportCommit = async () => {
    try {
      const result = await apiFetch<{ added: number; skipped: number; invalid: number }>('/import/commit', {
        method: 'POST',
        body: JSON.stringify({ rows: importRows }),
      })
      alert(`Import complete: ${result.added} added, ${result.skipped} skipped, ${result.invalid} invalid.`)
      setImportRows([])
      await loadData()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Import could not be committed.')
    }
  }

  const handleRevisionComplete = async (problemId: number, rating: string) => {
    setCompletionLoadingId(problemId)
    try {
      const result = await apiFetch<{ xp_earned: number; next_due_date: string; game_profile: GameProfile }>(`/revision/${problemId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ rating, notes: '' }),
      })
      setGameProfile(result.game_profile)
      setGameToast(`+${result.xp_earned} XP · next review ${result.next_due_date}`)
      await loadData()
      window.setTimeout(() => setGameToast(''), 4200)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not complete revision.')
    } finally {
      setCompletionLoadingId(null)
    }
  }

  const chooseCoachAction = (action: typeof coachQuickActions[number]) => {
    setCoachPrompt(action.prompt)
    setCoachMode(action.mode)
  }

  const openCoachForProblem = (problem: Problem) => {
    setSelectedProblemId(problem.id)
    setCoachMode('revise')
    setCoachPrompt(`Help me review ${problem.title}. Ask me a recall question about the key idea, then give feedback after I answer.`)
    setActivePage('coach')
  }

  const askCoach = async () => {
    setCoachLoading(true)
    setCoachError('')
    try {
      const body = {
        mode: coachMode,
        prompt: coachPrompt,
        problem_id: selectedProblem?.id ?? null,
      }

      const result = await apiFetch<{ response: { answer: string; disclaimer: string } }>('/coach', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setCoachResponse(`${result.response.answer}\n\n${result.response.disclaimer}`)
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : 'AI coach failed.')
    } finally {
      setCoachLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const data = await apiFetch<{ problems: Problem[]; revision_events: any[] }>('/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'recode-export.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export failed')
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await apiFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      })
      await loadData()
      alert('Settings saved.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to save settings')
    }
  }

  const completedQuestCount = revision.completed_today.length
  const revisionQuestCount = revision.due_today.length + revision.overdue.length
  const configuredDailyTarget = Number(settings.daily_revision_target ?? 5)
  const dailyTarget = Number.isFinite(configuredDailyTarget) && configuredDailyTarget > 0
    ? Math.floor(configuredDailyTarget)
    : 5
  const dailyGoalProgress = Math.min(completedQuestCount, dailyTarget)

  if (authState === 'checking') {
    return <main className="auth-screen"><section className="auth-card"><span className="brand-mark">R</span><p className="eyebrow">ReCode · Study Grove</p><h1>Opening your world…</h1><p>Connecting to your saved problems and revision quests.</p></section></main>
  }

  if (authState === 'error') {
    return <main className="auth-screen"><section className="auth-card"><span className="brand-mark">R</span><p className="eyebrow">ReCode · Connection</p><h1>Could not reach your world</h1><p role="alert">{authCheckError}</p><button onClick={() => window.location.reload()}>Try again</button></section></main>
  }

  if (authState === 'unauthenticated') {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <span className="brand-mark">R</span>
          <p className="eyebrow">ReCode · Private world</p>
          <h1>Welcome back, solver.</h1>
          <p>Enter your private access password to open your saved problems and revision quests.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="recode-password">Access password</label>
            <input
              id="recode-password"
              type="password"
              autoComplete="current-password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              required
              autoFocus
            />
            {authError && <p className="auth-error" role="alert">{authError}</p>}
            <button type="submit" disabled={authBusy}>{authBusy ? 'Opening your world…' : 'Enter ReCode'}</button>
          </form>
          <small>Your session is protected by a secure, HTTP-only cookie.</small>
        </section>
      </main>
    )
  }

  const renderDashboard = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Learning signal</p>
          <h1>Dashboard</h1>
        </div>
        <div className="action-row">
          <button onClick={() => setActivePage('bank')}>Add problem</button>
          <button className="secondary" onClick={() => setActivePage('revision')}>Open revision queue</button>
        </div>
      </div>

      {dashboard ? (
        <>
          <div className="hero-panel panel-block">
            <div className="hero-copy">
              <p className="eyebrow hero-eyebrow">◆ World 01 / Memory Grove</p>
              <h2>Welcome back, solver.</h2>
              <p>Today&apos;s objective: clear {revision.due_today.length + revision.overdue.length} revision quests, strengthen recall, and uncover your next unlock.</p>
              <div className="action-row">
                <button className="quest-button" onClick={() => setActivePage('revision')}><span aria-hidden="true">▶</span> Start revising</button>
                <button className="secondary" onClick={() => setActivePage('coach')}>AI Coach</button>
              </div>
            </div>

            <div className="voxel-scene" aria-label="Interactive block-built forest world">
              <div className="scene-sky" />
              <div className="scene-sun" />
              <div className="scene-cloud scene-cloud-one" />
              <div className="scene-cloud scene-cloud-two" />
              <div className="scene-ridge scene-ridge-far" />
              <div className="scene-ridge scene-ridge-near" />
              <div className="scene-tree scene-tree-one"><i /><b /></div>
              <div className="scene-tree scene-tree-two"><i /><b /></div>
              <div className="scene-tree scene-tree-three"><i /><b /></div>
              <div className="scene-ground" />
              <div className="scene-path" />
              <div className="scene-ore scene-ore-one" />
              <div className="scene-ore scene-ore-two" />
              <div className="world-locations" aria-label="Explore the world">
                <button className="world-location location-inventory" onClick={() => setActivePage('bank')} title="Inventory · I" aria-label="Open inventory and problem bank">
                  <span className="location-art location-chest" aria-hidden="true" /><span>Inventory</span>
                </button>
                <button className="world-location location-crafting" onClick={() => setActivePage('solve')} title="Crafting table · C" aria-label="Open crafting table and solve">
                  <span className="location-art location-table" aria-hidden="true" /><span>Craft</span>
                </button>
                <button className="world-location location-quests" onClick={() => setActivePage('revision')} title="Quest book · Q" aria-label="Open revision quests">
                  <span className="location-art location-book" aria-hidden="true" /><span>Quests</span>
                </button>
                <button className="world-location location-map" onClick={() => setActivePage('topics')} title="World map · M" aria-label="Open topic world map">
                  <span className="location-art location-map-art" aria-hidden="true" /><span>Map</span>
                </button>
                <button className="world-location location-companion" onClick={() => setActivePage('coach')} title="AI companion · A" aria-label="Talk to the AI companion">
                  <span className="location-art location-guide" aria-hidden="true" /><span>Guide</span>
                </button>
              </div>
              <span className="scene-caption">THE STUDY GROVE <b>LV. {String(gameProfile.level).padStart(2, '0')}</b></span>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card stat-card--emerald"><span><i className="collectible collectible-emerald" aria-hidden="true" /> Problems solved</span><strong>{dashboard.total_problems_solved}</strong><small>Knowledge collected</small></div>
            <div className="stat-card stat-card--cyan"><span><i className="collectible collectible-diamond" aria-hidden="true" /> Due today</span><strong>{dashboard.problems_due_today}</strong><small>Quests ready</small></div>
            <div className="stat-card stat-card--amber"><span><i className="collectible collectible-gold" aria-hidden="true" /> Overdue</span><strong>{dashboard.overdue_revisions}</strong><small>Return to these quests</small></div>
            <div className="stat-card stat-card--blue"><span><i className="collectible collectible-stone" aria-hidden="true" /> Solved share</span><strong>{dashboard.revision_completion_rate}%</strong><small>Saved problems marked solved</small></div>
          </div>

          <div className="content-grid split-grid">
            <div className="panel-block">
              <div className="section-heading">
                <h2>Topic progress</h2>
                <span className="tag inventory-tag">Collection · {dashboard.total_problems_solved}</span>
              </div>
              <div className="stack-list">
                {dashboard.topic_breakdown.slice(0, 6).map((topic: TopicStat) => (
                  <div key={topic.topic} className="mini-row">
                    <span>{topic.topic}</span>
                    <div className="bar"><span style={{ width: `${Math.min(100, (topic.solved / Math.max(topic.total, 1)) * 100)}%` }} /></div>
                    <strong>{topic.solved}/{topic.total}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-block">
              <div className="section-heading">
                <h2>Difficulty split</h2>
                <span className="tag tag-muted">Balanced</span>
              </div>
              <div className="stack-list">
                {Object.entries(dashboard.difficulty_breakdown as Record<string, number>).map(([label, value]) => (
                  <div key={label} className="mini-row">
                    <span>{label}</span>
                    <div className="bar neutral"><span style={{ width: `${(Number(value) / Math.max(problems.length, 1)) * 100}%` }} /></div>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="content-grid split-grid lower-grid">
            <div className="panel-block">
              <div className="section-heading">
                <h2>Next checkpoint</h2>
                <span className="tag quest-tag">Daily quest</span>
              </div>
              <div className="daily-goal-wrap">
                <div className="goal-bar emerald-progress" role="progressbar" aria-label="Daily revision goal" aria-valuemin={0} aria-valuemax={dailyTarget} aria-valuenow={dailyGoalProgress}>
                  <span style={{ width: `${Math.min(100, (dailyGoalProgress / dailyTarget) * 100)}%` }} />
                </div>
                <div className="goal-meta">
                  <strong>{dailyGoalProgress}/{dailyTarget}</strong>
                  <span>Daily revision goal</span>
                </div>
              </div>
              <ul className="event-list">
                {dashboard.upcoming_revision_schedule.length ? dashboard.upcoming_revision_schedule.map((item: any) => (
                  <li key={item.id} className="event-row"><strong>{item.title}</strong><span>{item.next_due_date}</span></li>
                )) : <li className="muted">No revisions scheduled yet.</li>}
              </ul>
            </div>

            <div className="panel-block">
              <div className="section-heading">
                <h2>Weekly review trail</h2>
                <span className="tag tag-muted">Completed reviews · last 7 days</span>
              </div>
              <div className="weekly-activity" role="group" aria-label="Completed revision counts for the last seven days">
                {dashboard.weekly_review_activity.map((day: { date: string; day: string; reviews: number }) => (
                  <div className="weekly-activity-day" key={day.date}>
                    <span className={`heat-cell level-${Math.min(day.reviews, 5)}`} title={`${day.reviews} completed ${day.reviews === 1 ? 'review' : 'reviews'} on ${day.date}`} aria-label={`${day.day}: ${day.reviews} ${day.reviews === 1 ? 'review' : 'reviews'}`} />
                    <small>{day.day}</small>
                  </div>
                ))}
              </div>
              <p className="small-note">A quiet day is just a rest day; your review plan and progress stay intact.</p>
              <ul className="event-list compact-list">
                {dashboard.recent_activity.length ? dashboard.recent_activity.map((item: any) => (
                  <li key={item.title + item.time} className="event-row"><strong>{item.title}</strong><span>{item.detail} • {item.time}</span></li>
                )) : <li className="muted">No recent activity. Start by solving a problem.</li>}
              </ul>
            </div>
          </div>
          <section className="panel-block achievements-panel">
            <div className="section-heading">
              <h2>Milestones collected</h2>
              <span className="tag inventory-tag">{gameProfile.achievements.length} earned</span>
            </div>
            {gameProfile.achievements.length ? (
              <div className="achievement-grid">
                {gameProfile.achievements.map((achievement) => (
                  <article className="achievement-item" key={achievement.id}>
                    <span className="achievement-gem" aria-hidden="true">◆</span>
                    <div><strong>{achievement.title}</strong><p>{achievement.description}</p><small>Earned {achievement.earned_at}</small></div>
                  </article>
                ))}
              </div>
            ) : <p className="empty-state">Your first milestone unlocks after your first completed revision. No streaks or achievements are assumed.</p>}
          </section>
        </>
      ) : (
        <div className="empty-state">{loadError ? 'Could not load world data. Use the adventure menu to retry a page or reload.' : 'Loading world data…'}</div>
      )}
    </section>
  )

  const renderSolve = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Practice mode</p>
          <h1>Solve</h1>
        </div>
      </div>

      <div className="content-grid split-grid">
        <div className="panel-block crafting-panel">
          <div className="crafting-heading"><span className="crafting-cube" aria-hidden="true" /><div><p className="eyebrow">Crafting table</p><h2>Focus & create</h2></div></div>
          {selectedProblem ? (
            <div className="problem-focus">
              <h3>{selectedProblem.title}</h3>
              <div className="meta-row">
                <span>{selectedProblem.topic}</span>
                <span>{selectedProblem.difficulty}</span>
                <span>{selectedProblem.status}</span>
              </div>
              <p>{selectedProblem.notes || 'No saved notes yet.'}</p>
              <div className="action-row">
                {selectedProblem.url ? <a href={selectedProblem.url} target="_blank" rel="noreferrer">Open on LeetCode</a> : null}
                <button className="secondary" onClick={() => setActivePage('coach')}>Ask AI Coach</button>
              </div>
              <p className="crafting-hint">Use this bench to record a solved problem and add it to your revision schedule.</p>
            </div>
          ) : (
            <div className="empty-state">No problem selected.</div>
          )}
          <form className="crafting-form" onSubmit={handleProblemSubmit}>
            <h3>Craft a new entry</h3>
            <input required aria-label="Problem title" value={problemForm.title} onChange={(event) => setProblemForm({ ...problemForm, title: event.target.value })} placeholder="Problem title" />
            <input aria-label="LeetCode URL" value={problemForm.url} onChange={(event) => setProblemForm({ ...problemForm, url: event.target.value })} placeholder="LeetCode URL" />
            <div className="crafting-row">
              <input aria-label="Topic" value={problemForm.topic} onChange={(event) => setProblemForm({ ...problemForm, topic: event.target.value })} placeholder="Topic" />
              <select aria-label="Difficulty" value={problemForm.difficulty} onChange={(event) => setProblemForm({ ...problemForm, difficulty: event.target.value })}>
                <option>Easy</option><option>Medium</option><option>Hard</option>
              </select>
            </div>
            <div className="crafting-row">
              <input aria-label="Date solved" type="date" value={problemForm.date_solved} onChange={(event) => setProblemForm({ ...problemForm, date_solved: event.target.value })} />
              <select aria-label="Problem status" value={problemForm.status} onChange={(event) => setProblemForm({ ...problemForm, status: event.target.value })}>
                <option>Solved</option><option>Unsolved</option><option>Needs Practice</option>
              </select>
            </div>
            <textarea aria-label="Personal approach" value={problemForm.notes} onChange={(event) => setProblemForm({ ...problemForm, notes: event.target.value })} placeholder="Personal approach or notes" />
            <button type="submit">Add to inventory & schedule</button>
          </form>
        </div>

        <div className="panel-block crafting-queue">
          <div className="section-heading"><h2>Recipe ingredients</h2><button className="secondary" onClick={() => setActivePage('bank')}>Open inventory</button></div>
          <ul className="event-list compact-list">
            {problems.slice(0, 5).map((problem) => (
              <li key={problem.id}>
                <button type="button" className={`recipe-select${selectedProblem?.id === problem.id ? ' selected' : ''}`} onClick={() => setSelectedProblemId(problem.id)}>
                  <strong>{problem.title}</strong>
                  <span>{problem.topic} • {problem.difficulty}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )

  const renderRevision = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Spaced repetition</p>
          <h1>Revision</h1>
        </div>
      </div>

      <div className="revision-section-grid">
        <div className="panel-block quest-board">
          <div className="section-heading"><h2>Active quests</h2><span className="tag quest-tag">Due today · {revision.due_today.length}</span></div>
          <div className="card-stack">
            {revision.due_today.length ? revision.due_today.map((problem) => (
              <article className="problem-card quest-card quest-due" key={problem.id}>
                <div className="quest-card-top"><span className="quest-type">MEMORY QUEST</span><span className="difficulty-badge">{problem.difficulty}</span></div>
                <div className="problem-topline"><h3>{problem.title}</h3></div>
                <p><span className="topic-badge">{problem.topic}</span></p>
                <small className="quest-date"><span className="quest-status-mark" /> Due today · {problem.next_due_date || 'today'}</small>
                <div className="card-actions">
                  {problem.url ? <a className="open-problem" href={problem.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a> : <span className="open-problem unavailable-link">No problem link</span>}
                  <button type="button" className="secondary quest-coach-link" onClick={() => openCoachForProblem(problem)}>Ask companion</button>
                  <div className="rating-controls" role="group" aria-label={`Recall rating for ${problem.title}`}>
                    {['Easy', 'Struggled', 'Forgot'].map((rating) => <button type="button" className={`rating-button ${ratingMap[problem.id] === rating ? 'is-selected' : ''}`} aria-pressed={ratingMap[problem.id] === rating} key={rating} onClick={() => setRatingMap({ ...ratingMap, [problem.id]: rating })}>{rating}</button>)}
                  </div>
                  <button className="complete-quest" disabled={completionLoadingId === problem.id} onClick={() => handleRevisionComplete(problem.id, ratingMap[problem.id] || 'Easy')}>{completionLoadingId === problem.id ? 'Saving quest…' : 'Complete quest'}</button>
                </div>
              </article>
            )) : <div className="empty-state quest-empty">No active quests today. Your mind can rest or you can explore a new problem.</div>}
          </div>
        </div>

        <div className="panel-block quest-board">
          <div className="section-heading"><h2>Return to the trail</h2><span className="tag overdue-tag">Overdue · {revision.overdue.length}</span></div>
          <div className="card-stack">
            {revision.overdue.length ? revision.overdue.map((problem) => (
              <article className="problem-card quest-card quest-overdue" key={problem.id}>
                <div className="quest-card-top"><span className="quest-type">REVISIT QUEST</span><span className="difficulty-badge">{problem.difficulty}</span></div>
                <div className="problem-topline"><h3>{problem.title}</h3></div>
                <p><span className="topic-badge">{problem.topic}</span></p>
                <small className="quest-date"><span className="quest-status-mark" /> Overdue · {problem.next_due_date || 'date not set'}</small>
                <div className="card-actions">
                  {problem.url ? <a className="open-problem" href={problem.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a> : <span className="open-problem unavailable-link">No problem link</span>}
                  <button type="button" className="secondary quest-coach-link" onClick={() => openCoachForProblem(problem)}>Ask companion</button>
                  <div className="rating-controls" role="group" aria-label={`Recall rating for ${problem.title}`}>
                    {['Easy', 'Struggled', 'Forgot'].map((rating) => <button type="button" className={`rating-button ${ratingMap[problem.id] === rating ? 'is-selected' : ''}`} aria-pressed={ratingMap[problem.id] === rating} key={rating} onClick={() => setRatingMap({ ...ratingMap, [problem.id]: rating })}>{rating}</button>)}
                  </div>
                  <button className="complete-quest" disabled={completionLoadingId === problem.id} onClick={() => handleRevisionComplete(problem.id, ratingMap[problem.id] || 'Struggled')}>{completionLoadingId === problem.id ? 'Saving quest…' : 'Resume quest'}</button>
                </div>
              </article>
            )) : <div className="empty-state quest-empty">No abandoned trails. Nice work keeping up with your reviews.</div>}
          </div>
        </div>

        <div className="panel-block quest-board">
          <div className="section-heading"><h2>On the horizon</h2><span className="tag tag-muted">Upcoming · {revision.upcoming.length}</span></div>
          <div className="card-stack">
            {revision.upcoming.length ? revision.upcoming.slice(0, 6).map((problem) => (
              <article className="problem-card quest-card quest-upcoming" key={problem.id}>
                <div className="quest-card-top"><span className="quest-type">UPCOMING QUEST</span><span className="difficulty-badge">{problem.difficulty}</span></div>
                <div className="problem-topline"><h3>{problem.title}</h3></div>
                <p><span className="topic-badge">{problem.topic}</span></p>
                <small className="quest-date"><span className="quest-status-mark" /> Scheduled · {problem.next_due_date || 'date not set'}</small>
              </article>
            )) : <div className="empty-state">No upcoming tasks.</div>}
          </div>
        </div>

        <div className="panel-block quest-board">
          <div className="section-heading"><h2>Quest complete</h2><span className="tag completed-tag">Today · {revision.completed_today.length}</span></div>
          <div className="card-stack">
            {revision.completed_today.length ? revision.completed_today.map((problem) => (
              <article className="problem-card quest-card quest-completed" key={problem.id}>
                <div className="quest-card-top"><span className="quest-type">CLEARED</span><span className="difficulty-badge">{problem.difficulty}</span></div>
                <div className="problem-topline"><h3>{problem.title}</h3></div>
                <p><span className="topic-badge">{problem.topic}</span></p>
                <small className="quest-date"><span className="quest-status-mark" /> Reviewed today · next review {problem.next_due_date || 'not scheduled'}</small>
              </article>
            )) : <div className="empty-state">No reviews completed today yet.</div>}
          </div>
        </div>
      </div>
    </section>
  )

  const renderBank = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Knowledge graph</p>
          <h1>Problem Bank</h1>
        </div>
      </div>

      <div className="content-grid split-grid">
        <form className="panel-block form-block" onSubmit={handleProblemSubmit}>
          <h2>Problem workbench</h2>
          <div className="form-grid">
            <input value={problemForm.title} onChange={(event) => setProblemForm({ ...problemForm, title: event.target.value })} placeholder="Problem title" />
            <input value={problemForm.url} onChange={(event) => setProblemForm({ ...problemForm, url: event.target.value })} placeholder="LeetCode URL" />
            <input value={problemForm.topic} onChange={(event) => setProblemForm({ ...problemForm, topic: event.target.value })} placeholder="Topic" />
            <input value={problemForm.secondary_topics} onChange={(event) => setProblemForm({ ...problemForm, secondary_topics: event.target.value })} placeholder="Secondary topics" />
            <select value={problemForm.difficulty} onChange={(event) => setProblemForm({ ...problemForm, difficulty: event.target.value })}>
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
            <input type="date" value={problemForm.date_solved} onChange={(event) => setProblemForm({ ...problemForm, date_solved: event.target.value })} />
            <input value={problemForm.time_complexity} onChange={(event) => setProblemForm({ ...problemForm, time_complexity: event.target.value })} placeholder="Time complexity" />
            <input value={problemForm.space_complexity} onChange={(event) => setProblemForm({ ...problemForm, space_complexity: event.target.value })} placeholder="Space complexity" />
            <select value={problemForm.status} onChange={(event) => setProblemForm({ ...problemForm, status: event.target.value })}>
              <option>Unsolved</option>
              <option>Solved</option>
              <option>Needs Practice</option>
            </select>
            <textarea value={problemForm.notes} onChange={(event) => setProblemForm({ ...problemForm, notes: event.target.value })} placeholder="Personal approach or notes" />
          </div>
          <button type="submit">Save problem</button>
        </form>

        <div className="panel-block">
          <h2>Import CSV / XLSX</h2>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} />
          <div className="import-preview">
            {importRows.length ? (
              <>
                <ul>
                  {importRows.slice(0, 6).map((row, index) => (
                    <li key={`${row.title ?? 'row'}-${index}`}><strong>{row.title}</strong><span>{row.topic || 'General'} • {row.difficulty || 'Medium'}</span></li>
                  ))}
                </ul>
                <button onClick={handleImportCommit}>Commit import</button>
              </>
            ) : (
              <p className="muted">Upload a file to preview incoming problems.</p>
            )}
          </div>
        </div>
      </div>

      <div className="panel-block list-panel">
        <div className="toolbar-row">
            <input ref={searchInputRef} placeholder="Search inventory  ( / )" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select aria-label="Filter by topic" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
              <option value="all">All topics</option>
              {[...new Set(problems.map((problem) => problem.topic))].sort().map((topic) => <option key={topic}>{topic}</option>)}
            </select>
            <select aria-label="Filter by difficulty" value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}>
              <option value="all">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
            <select aria-label="Filter by revision status" value={problemFilter} onChange={(event) => setProblemFilter(event.target.value)}>
              <option value="all">All revision states</option><option value="due">Due today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option><option value="completed">Reviewed today</option><option value="unscheduled">Unscheduled</option>
            </select>
            <select aria-label="Sort inventory" value={problemSort} onChange={(event) => setProblemSort(event.target.value)}>
              <option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="topic">Topic</option>
            </select>
          </div>
        <div className="inventory-layout">
          <div className="inventory-grid" role="group" aria-label="Problem inventory">
            {visibleProblems.map((problem) => (
              <button className={`inventory-slot ${selectedProblemId === problem.id ? 'selected' : ''}`} key={problem.id} onClick={() => setSelectedProblemId(problem.id)} aria-pressed={selectedProblemId === problem.id} aria-label={`${problem.title}, ${problem.topic}, ${problem.difficulty}, ${problemRevisionState(problem.id, revision)}`}>
                <span className={`item-icon item-${problem.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} aria-hidden="true"><i /><b /></span>
                <strong>{problem.title}</strong>
                <span className="item-meta">{problem.topic} · {problem.difficulty}</span>
                <span className={`item-state state-${problemRevisionState(problem.id, revision)}`}>{problemRevisionState(problem.id, revision).replace('-', ' ')}</span>
              </button>
            ))}
            {!visibleProblems.length && <div className="empty-state inventory-empty">No items match these filters.</div>}
          </div>
          <aside className="inventory-details" aria-live="polite">
            {selectedProblem ? (
              <>
                <p className="eyebrow">Selected item</p>
                <div className="detail-art item-icon" aria-hidden="true"><i /><b /></div>
                <h3>{selectedProblem.title}</h3>
                <p className="topic-badge">{selectedProblem.topic}</p>
                <dl className="item-facts">
                  <div><dt>Difficulty</dt><dd>{selectedProblem.difficulty}</dd></div>
                  <div><dt>Revision state</dt><dd>{problemRevisionState(selectedProblem.id, revision)}</dd></div>
                  <div><dt>Next due</dt><dd>{selectedProblem.next_due_date || 'Not scheduled'}</dd></div>
                  <div><dt>Solved</dt><dd>{selectedProblem.date_solved || 'Not recorded'}</dd></div>
                </dl>
                <p className="inventory-note">{selectedProblem.notes || 'No personal approach saved yet.'}</p>
                {selectedProblem.url && <a className="open-problem inventory-open" href={selectedProblem.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a>}
                <button className="secondary" onClick={() => setActivePage('solve')}>Use at crafting table</button>
              </>
            ) : <p className="empty-state">Select a real problem item to inspect it.</p>}
          </aside>
        </div>
      </div>
    </section>
  )

  const renderTopics = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Retention signal</p>
          <h1>Topics & Progress</h1>
        </div>
      </div>

      <div className="world-map panel-block">
        <div className="section-heading">
          <h2>Explore the learning regions</h2>
          <span className="tag tag-muted">All regions open · based on your real topics</span>
        </div>
        <div className="region-grid">
          {topics.map((topic, index) => {
            const topicName = topic.topic.toLowerCase()
            const region = topicName.includes('array') || topicName.includes('string') || topicName.includes('hash')
              ? 'Grasslands'
              : topicName.includes('search') || topicName.includes('sort')
                ? 'Crystal Highlands'
                : topicName.includes('tree')
                  ? 'Memory Forest'
                  : topicName.includes('graph')
                    ? 'Echo Caves'
                    : topicName.includes('dynamic') || topicName.includes('dp')
                      ? 'Deepstone Depths'
                      : 'Trail Region'
            return (
              <button
                className={`region-tile biome-${index % 5}${selectedTopic === topic.topic ? ' selected' : ''}`}
                key={topic.topic}
                onClick={() => setSelectedTopic(topic.topic)}
                aria-pressed={selectedTopic === topic.topic}
                title={`View real ${topic.topic} statistics`}
              >
                <span className="region-art" aria-hidden="true"><i /><b /><em /></span>
                <span className="region-info"><strong>{topic.topic}</strong><small>{region}</small></span>
                <span className="region-count">{topic.solved}/{topic.total}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel-block topic-grid">
        {topics.filter((topic) => !selectedTopic || topic.topic === selectedTopic).map((topic) => (
          <div key={topic.topic} className="topic-card">
            <h3>{topic.topic}</h3>
            <div className="meta-row compact-meta">
              <span>Solved: {topic.solved}</span>
              <span>In progress: {topic.needs_practice}</span>
              <span>Total tracked: {topic.total}</span>
            </div>
            <div className="mini-row"><span>Easy</span><strong>{topic.easy}</strong></div>
            <div className="mini-row"><span>Medium</span><strong>{topic.medium}</strong></div>
            <div className="mini-row"><span>Hard</span><strong>{topic.hard}</strong></div>
            <div className="mini-row"><span>Struggles</span><strong>{topic.struggles}</strong></div>
            <div className="mini-row"><span>Forgotten</span><strong>{topic.forgotten}</strong></div>
            <div className="topic-problems">
              <strong>Collected problems</strong>
              {problems.filter((problem) => problem.topic === topic.topic || problem.secondary_topics?.split(',').map((value) => value.trim()).includes(topic.topic)).map((problem) => (
                <button key={problem.id} className="topic-problem-link" onClick={() => {
                  setSelectedProblemId(problem.id)
                  setActivePage('bank')
                }}>{problem.title} · {problem.difficulty}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="small-note">Topic totals can overlap and should not be added together to estimate unique solved-problem totals.</p>
    </section>
  )

  const renderCoach = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">In-world AI companion</p>
          <h1>AI DSA Coach</h1>
        </div>
      </div>

      <div className="content-grid split-grid">
        <div className="panel-block coach-panel">
          <div className="coach-identity">
            <div className="coach-avatar">A</div>
            <div>
              <h2>Pixel mentor</h2>
              <span>Local {settings.ollama_model ?? 'gemma3:4b'} · Ollama</span>
            </div>
          </div>

          <label className="inline-label">Coach mode</label>
          <select value={coachMode} onChange={(event) => setCoachMode(event.target.value)}>
            <option value="solve">Solve</option>
            <option value="hint">Hint</option>
            <option value="revise">Revise</option>
            <option value="plan">Plan</option>
          </select>

          <div className="quick-actions">
            {coachQuickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="chip-button"
                onClick={() => chooseCoachAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>

          <textarea value={coachPrompt} onChange={(event) => setCoachPrompt(event.target.value)} rows={7} />
          <button onClick={askCoach} disabled={coachLoading}>{coachLoading ? 'Thinking…' : 'Ask companion'}</button>
          <p className={aiStatus.available ? 'small-note model-ready' : 'small-note model-unavailable'}><span className="model-indicator" aria-hidden="true" />{aiStatus.message}</p>
          {coachError && <div className="coach-error" role="alert">{coachError}</div>}
        </div>

        <div className="panel-block coach-panel">
          <h2>Coach response</h2>
          {coachResponse ? (
            <div className="chat-bubble">
              <pre>{coachResponse}</pre>
            </div>
          ) : (
            <div className="empty-state coach-empty">Ask the coach to get guidance on intuition, edge cases, or revision strategy.</div>
          )}
          {selectedProblem && (
            <div className="problem-context">
              <span>Context</span>
              <strong>{selectedProblem.title}</strong>
              <small>{selectedProblem.topic} • {selectedProblem.difficulty}</small>
            </div>
          )}
        </div>
      </div>
    </section>
  )

  const renderSettings = () => (
    <section className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Personalization</p>
          <h1>Settings</h1>
        </div>
      </div>

      <form className="panel-block settings-form" onSubmit={saveSettings}>
        <div className="form-grid single-row">
          <label>
            Revision intervals
            <input value={settings.revision_intervals ?? '1,3,7,14'} onChange={(event) => setSettings({ ...settings, revision_intervals: event.target.value })} />
          </label>
          <label>
            Daily revision target
            <input value={settings.daily_revision_target ?? '5'} onChange={(event) => setSettings({ ...settings, daily_revision_target: event.target.value })} />
          </label>
          <label>
            Preferred language
            <input value={settings.preferred_language ?? 'Python'} onChange={(event) => setSettings({ ...settings, preferred_language: event.target.value })} />
          </label>
          <label>
            Model configuration
            <input value={settings.ollama_model ?? 'gemma3:4b'} onChange={(event) => setSettings({ ...settings, ollama_model: event.target.value })} />
          </label>
        </div>
        <div className="action-row">
          <button type="submit">Save settings</button>
          <button type="button" className="secondary" onClick={handleExport}>Export history</button>
        </div>
      </form>

      <div className="panel-block">
        <h2>AI availability</h2>
        <p className={aiStatus.available ? 'ok' : 'warn'}>{aiStatus.message}</p>
        {aiStatus.available ? <p className="small-note">Local inference is active. Model output may still contain mistakes and should be verified.</p> : <p className="small-note">The rest of the app continues to function even when Ollama is unavailable.</p>}
      </div>
    </section>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div>
            <strong>ReCode</strong>
            <small>AI DSA revision</small>
          </div>
        </div>

        <nav aria-label="Adventure navigation">
          <p className="nav-heading">ADVENTURE MENU</p>
          {navItems.map((item) => (
            <button className={`nav-item nav-${item.key}${activePage === item.key ? ' active' : ''}`} key={item.key} onClick={() => setActivePage(item.key)} aria-current={activePage === item.key ? 'page' : undefined}>
              <span className={`nav-icon nav-icon-${item.key}`} aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
              {item.key === 'revision' && revision.due_today.length + revision.overdue.length > 0 && <span className="nav-count">{revision.due_today.length + revision.overdue.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-avatar" aria-hidden="true">R</div>
          <div className="sidebar-player"><strong>Trailblazer</strong><small>Learning mode</small></div>
          <span className="player-level">{String(gameProfile.level).padStart(2, '0')}</span>
        </div>
      </aside>

      <main className="content-area">
        <section className="game-hud" aria-label="Player status">
          <div className="hud-level">
            <span className="hud-level-icon" aria-hidden="true">L{gameProfile.level}</span>
            <div className="hud-xp">
              <div className="hud-xp-title"><strong>Level {gameProfile.level}</strong><span>{gameProfile.xp} total XP</span></div>
              <div className="hud-xp-bar" role="progressbar" aria-label="Experience to next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={gameProfile.level_xp}><span style={{ width: `${gameProfile.level_xp}%` }} /></div>
              <small>{gameProfile.xp_to_next_level} XP to next level</small>
            </div>
          </div>
          <div className="hud-quest">
            <span className="hud-quest-icon" aria-hidden="true">✦</span>
            <div><strong>Daily quest</strong><small>{completedQuestCount}/{dailyTarget} reviews · {revisionQuestCount} ready</small></div>
          </div>
          <div className="hud-streak" aria-label={`${gameProfile.current_streak} ${gameProfile.current_streak === 1 ? 'day' : 'days'} revision streak`}>
            <span className="streak-flame" aria-hidden="true">▰</span><div><strong>{gameProfile.current_streak} {gameProfile.current_streak === 1 ? 'day' : 'days'} streak</strong><small>Best: {gameProfile.best_streak} {gameProfile.best_streak === 1 ? 'day' : 'days'}</small></div>
          </div>
          <button className="hud-help" title="Keyboard controls (?)" aria-label="Show keyboard controls" onClick={() => setShowShortcuts(true)}>?</button>
          <button className="hud-pause" title="Pause menu (Escape)" aria-label="Open pause menu" onClick={() => setPaused(true)}>Ⅱ <span>Menu</span></button>
        </section>

        {loadError && <div className="app-alert" role="alert"><span>{loadError}</span><button aria-label="Dismiss message" onClick={() => setLoadError('')}>×</button></div>}
        {gameToast && <div className="game-toast" role="status" aria-live="polite"><span className="toast-gem" aria-hidden="true">◆</span>{gameToast}</div>}

        {paused && (
          <div className="menu-backdrop">
            <section className="game-menu pause-menu" role="dialog" aria-modal="true" aria-labelledby="pause-title">
              <p className="eyebrow">Game paused</p>
              <h2 id="pause-title">Pause menu</h2>
              <button onClick={() => setPaused(false)}>Return to world</button>
              <button className="secondary" onClick={() => { setPaused(false); setActivePage('settings') }}>Settings & controls</button>
              <button className="secondary" onClick={() => { setPaused(false); setActivePage('bank') }}>Open inventory</button>
              <button className="secondary" onClick={() => { setPaused(false); void handleExport() }}>Export save data</button>
              {authRequired && <button className="secondary" onClick={() => void handleLogout()}>Sign out</button>}
              <small>Progress and revision history are saved to your configured database.</small>
            </section>
          </div>
        )}

        {showShortcuts && (
          <div className="menu-backdrop">
            <section className="game-menu shortcuts-menu" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
              <button className="menu-close" aria-label="Close keyboard controls" onClick={() => setShowShortcuts(false)}>×</button>
              <p className="eyebrow">Explorer controls</p>
              <h2 id="shortcuts-title">Keyboard shortcuts</h2>
              <dl className="shortcut-list">
                <div><dt>I / B</dt><dd>Inventory</dd></div>
                <div><dt>C</dt><dd>Crafting table</dd></div>
                <div><dt>Q</dt><dd>Quest book</dd></div>
                <div><dt>M</dt><dd>World map</dd></div>
                <div><dt>A</dt><dd>AI companion</dd></div>
                <div><dt>/</dt><dd>Search inventory</dd></div>
                <div><dt>Esc</dt><dd>Pause menu</dd></div>
                <div><dt>?</dt><dd>Show these controls</dd></div>
              </dl>
            </section>
          </div>
        )}

        {activePage === 'dashboard' && renderDashboard()}
        {activePage === 'solve' && renderSolve()}
        {activePage === 'revision' && renderRevision()}
        {activePage === 'bank' && renderBank()}
        {activePage === 'topics' && renderTopics()}
        {activePage === 'coach' && renderCoach()}
        {activePage === 'settings' && renderSettings()}
      </main>
    </div>
  )
}

export default App
