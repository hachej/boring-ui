import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, Pencil, PenLine, BookOpen, Search, Globe, Bot, Settings } from 'lucide-react'

/**
 * PermissionPanel - Displays permission request with options
 *
 * Generic panel for all Claude Code tool permissions:
 * - File operations (Write, Edit, Read)
 * - Command execution (Bash)
 * - Search (Glob, Grep)
 * - Network (WebFetch, WebSearch)
 * - Agent operations (Task)
 */

const DEFAULT_DENY_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
const PLAN_DENY_MESSAGE = 'User chose to stay in plan mode and continue planning'
const DENY_REASON_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: "

const DESTINATION_LABELS = {
  localSettings: 'this project (just you)',
  userSettings: 'all projects',
  projectSettings: 'this project (shared)',
  session: 'this session',
  cliArg: 'CLI',
}
const DESTINATION_TITLES = {
  localSettings: 'Saves to .claude/settings.local.json (gitignored)',
  userSettings: 'Saves to ~/.claude/settings.json',
  projectSettings: 'Saves to .claude/settings.json (shared with team)',
  session: 'Only for this session (not saved)',
  cliArg: 'From command line arguments',
}
const DESTINATION_ORDER = ['localSettings', 'userSettings', 'projectSettings', 'session']
const EMPTY_QUESTIONS = []

const styles = {
  container: {
    backgroundColor: 'var(--chat-panel-bg)',
    border: '1px solid var(--chat-border)',
    borderRadius: 'var(--chat-radius-md, 8px)',
    padding: 'var(--chat-spacing-md, 12px)',
    margin: 'var(--chat-spacing-md, 12px)',
  },
  title: {
    color: 'var(--chat-text)',
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: 'var(--chat-spacing-sm, 8px)',
  },
  toolInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: 'var(--chat-spacing-sm, 8px)',
    fontSize: 'var(--text-sm)',
    flexWrap: 'wrap',
  },
  toolBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'white',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
  },
  toolIcon: {
    fontSize: '12px',
  },
  primaryInfo: {
    color: 'var(--chat-text)',
    fontFamily: 'monospace',
    fontSize: '12px',
    wordBreak: 'break-all',
  },
  secondaryInfo: {
    color: 'var(--chat-text-muted)',
    fontSize: '12px',
    marginBottom: 'var(--chat-spacing-sm, 8px)',
    fontStyle: 'italic',
  },
  diffContainer: {
    backgroundColor: 'var(--color-pre-bg)',
    border: '1px solid var(--chat-border)',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: 'var(--chat-spacing-sm, 8px)',
    maxHeight: '200px',
    overflowY: 'auto',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  diffLine: {
    whiteSpace: 'pre',
    color: 'var(--chat-text-muted)',
  },
  diffAdded: {
    backgroundColor: 'var(--chat-diff-add-bg)',
    color: 'var(--chat-diff-add-text)',
  },
  diffRemoved: {
    backgroundColor: 'var(--chat-diff-remove-bg)',
    color: 'var(--chat-diff-remove-text)',
  },
  diffHunk: {
    color: 'var(--chat-info)',
    backgroundColor: 'var(--color-info-light)',
  },
  codeContainer: {
    backgroundColor: 'var(--color-pre-bg)',
    border: '1px solid var(--chat-border)',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: 'var(--chat-spacing-sm, 8px)',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  codeContent: {
    margin: 0,
    fontFamily: 'monospace',
    fontSize: '12px',
    color: 'var(--chat-text-muted)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: '1px solid var(--chat-border)',
    borderRadius: 'var(--chat-radius-sm, 4px)',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--chat-text)',
    fontSize: '14px',
    transition: 'background-color var(--transition-fast)',
  },
  optionSelected: {
    backgroundColor: 'var(--chat-accent)',
    borderColor: 'var(--chat-accent)',
    color: 'white',
  },
  optionDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  optionNumber: {
    opacity: 0.7,
    fontSize: 'var(--text-sm)',
  },
  optionLabel: {
    flex: 1,
  },
  customForm: {
    marginTop: 'var(--chat-spacing-sm, 8px)',
  },
  customInput: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'var(--chat-input-bg)',
    border: '1px solid var(--chat-border)',
    borderRadius: 'var(--chat-radius-sm, 4px)',
    color: 'var(--chat-text-muted)',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  destinationLink: {
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    cursor: 'pointer',
  },
  destinationStatic: {
    textDecoration: 'none',
    cursor: 'default',
  },
  bashCommand: {
    marginBottom: 'var(--chat-spacing-sm, 8px)',
  },
  bashCommandInput: {
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: 'var(--chat-input-bg)',
    border: '1px solid var(--chat-border)',
    borderRadius: '4px',
    padding: '6px 8px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    outline: 'none',
  },
  questionContainer: {
    border: '1px solid var(--chat-border)',
    borderRadius: '6px',
    marginBottom: 'var(--chat-spacing-sm, 8px)',
    overflow: 'hidden',
  },
  questionNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'var(--chat-panel-bg)',
    borderBottom: '1px solid var(--chat-border)',
    padding: '6px 8px',
  },
  questionTabs: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  questionTab: {
    border: '1px solid transparent',
    borderRadius: '4px',
    padding: '4px 6px',
    background: 'transparent',
    color: 'var(--chat-text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
  },
  questionTabActive: {
    borderColor: 'var(--chat-accent)',
    color: 'var(--chat-text)',
  },
  questionTabAnswered: {
    color: 'var(--chat-text)',
  },
  questionClose: {
    background: 'transparent',
    border: 'none',
    color: 'var(--chat-text-muted)',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '0 4px',
  },
  questionBody: {
    padding: '10px',
  },
  questionTitle: {
    color: 'var(--chat-text)',
    fontWeight: 600,
    marginBottom: '8px',
  },
  questionOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  questionOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid var(--chat-border)',
    background: 'transparent',
    color: 'var(--chat-text)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  questionOptionSelected: {
    borderColor: 'var(--chat-accent)',
    backgroundColor: 'var(--color-info-bg)',
  },
  questionOptionConfirming: {
    borderColor: 'var(--chat-success)',
  },
  questionOptionControl: {
    marginTop: '4px',
  },
  questionOptionContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
  },
  questionOptionLabel: {
    fontWeight: 500,
  },
  questionOptionDescription: {
    color: 'var(--chat-text-muted)',
    fontSize: '12px',
  },
  checkbox: {
    width: '14px',
    height: '14px',
    border: '1px solid var(--chat-border)',
    borderRadius: '2px',
    display: 'inline-block',
  },
  checkboxChecked: {
    backgroundColor: 'var(--chat-accent)',
  },
  radio: {
    width: '14px',
    height: '14px',
    border: '1px solid var(--chat-border)',
    borderRadius: '50%',
    display: 'inline-block',
  },
  radioChecked: {
    backgroundColor: 'var(--chat-accent)',
  },
  otherInput: {
    marginTop: '6px',
    padding: '6px 8px',
    borderRadius: '4px',
    border: '1px solid var(--chat-border)',
    backgroundColor: 'var(--chat-input-bg)',
    color: 'var(--chat-text)',
    fontSize: '12px',
  },
  questionEmpty: {
    color: 'var(--chat-text-muted)',
    fontSize: '12px',
  },
}

const normalizeToolName = (name) => String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const basenameFromPath = (value) => {
  if (!value) return ''
  const parts = String(value).split(/[/\\]/)
  return parts[parts.length - 1] || value
}
const stripWildcardRule = (value) => {
  const match = String(value || '').match(/^(.+):\*$/)
  return match ? match[1] : null
}
const formatRuleLabel = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.length <= 20) return trimmed
  return `${trimmed.slice(0, 17)}...`
}
const applySuggestionDestination = (suggestions, destination) => {
  if (!Array.isArray(suggestions)) return []
  return suggestions.map((suggestion) => {
    if (!suggestion || typeof suggestion !== 'object') return suggestion
    if (suggestion.type === 'setMode') return suggestion
    return { ...suggestion, destination }
  })
}
const buildSuggestionLabel = (suggestions, destination, onDestinationChange) => {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return "Yes, and don't ask again"
  }

  const rules = []
  const directories = []
  let setMode = null

  suggestions.forEach((suggestion) => {
    if (!suggestion || typeof suggestion !== 'object') return
    if (suggestion.type === 'addRules') {
      suggestion.rules?.forEach((rule) => {
        if (rule?.ruleContent) {
          const stripped = stripWildcardRule(rule.ruleContent)
          rules.push(stripped || formatRuleLabel(rule.ruleContent))
        } else if (rule?.toolName) {
          rules.push(rule.toolName)
        }
      })
    } else if (suggestion.type === 'addDirectories') {
      suggestion.directories?.forEach((dir) => {
        if (dir) directories.push(`${basenameFromPath(dir)}/`)
      })
    } else if (suggestion.type === 'setMode') {
      setMode = { mode: suggestion.mode, destination: suggestion.destination }
    }
  })

  if (rules.length === 0 && directories.length === 0 && setMode) {
    if (setMode.mode === 'acceptEdits') return 'Yes, allow all edits this session'
    if (setMode.mode === 'default') return 'Yes, return to normal mode'
    return "Yes, and don't ask again"
  }

  const destinationLabel = DESTINATION_LABELS[destination] || destination
  const destinationTitle = DESTINATION_TITLES[destination] || ''
  const canCycleDestination = DESTINATION_ORDER.includes(destination)
  const destinationNode = (
    <span
      style={canCycleDestination ? styles.destinationLink : styles.destinationStatic}
      title={destinationTitle}
      onClick={(event) => {
        if (!canCycleDestination) return
        event.stopPropagation()
        const currentIndex = DESTINATION_ORDER.indexOf(destination)
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % DESTINATION_ORDER.length
        onDestinationChange(DESTINATION_ORDER[nextIndex])
      }}
    >
      {destinationLabel}
    </span>
  )

  if (rules.length > 0) {
    if (rules.length === 1) {
      return <>Yes, allow {rules[0]} for {destinationNode}</>
    }
    if (rules.length === 2) {
      return <>Yes, allow {rules[0]} and {rules[1]} for {destinationNode}</>
    }
    return <>Yes, allow {rules[0]} and {rules.length - 1} more for {destinationNode}</>
  }

  if (directories.length > 0) {
    if (directories.length === 1) {
      return <>Yes, allow access to {directories[0]} for {destinationNode}</>
    }
    return <>Yes, allow access to {directories.length} directories for {destinationNode}</>
  }

  return "Yes, and don't ask again"
}

const buildPermissionTitle = (toolName, toolInput) => {
  const normalized = normalizeToolName(toolName)
  const path = toolInput?.file_path || toolInput?.path || toolInput?.notebook_path
  const basename = basenameFromPath(path)

  if (normalized === 'bash') return 'Allow this bash command?'
  if (normalized === 'read' && basename) return `Allow reading from ${basename}?`
  if (normalized === 'write' && basename) return `Allow write to ${basename}?`
  if ((normalized === 'edit' || normalized === 'multiedit') && basename) {
    return `Allow editing ${basename}?`
  }
  if (normalized === 'exitplanmode') return 'Accept this plan?'
  if (normalized === 'websearch') return 'Allow searching for this query?'
  if (normalized === 'slashcommand' && toolInput?.command) {
    const name = String(toolInput.command).split(' ')[0]
    return `Let Claude run the ${name} slash command?`
  }
  if (toolName) return `Do you want to proceed with ${toolName}?`
  return 'Do you want to proceed?'
}


const DiffViewer = ({ diff }) => {
  if (!diff) return null

  const lines = diff.split('\n')
  return (
    <div style={styles.diffContainer}>
      {lines.map((line, i) => {
        let lineStyle = styles.diffLine
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineStyle = { ...lineStyle, ...styles.diffAdded }
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineStyle = { ...lineStyle, ...styles.diffRemoved }
        } else if (line.startsWith('@@')) {
          lineStyle = { ...lineStyle, ...styles.diffHunk }
        }
        return (
          <div key={i} style={lineStyle}>
            {line}
          </div>
        )
      })}
    </div>
  )
}

const CodeBlock = ({ content, maxLines = 10 }) => {
  if (!content) return null
  const lines = content.split('\n')
  const truncated = lines.length > maxLines
  const displayLines = truncated ? lines.slice(0, maxLines) : lines

  return (
    <div style={styles.codeContainer}>
      <pre style={styles.codeContent}>
        {displayLines.join('\n')}
        {truncated && `\n... (${lines.length - maxLines} more lines)`}
      </pre>
    </div>
  )
}

// Extract display info based on tool type
const getToolDisplay = (toolName, toolInput) => {
  const name = (toolName || '').toLowerCase()
  const input = toolInput || {}

  switch (name) {
    case 'bash':
      return {
        icon: <Terminal size={12} />,
        color: 'var(--color-error)',
        primary: input.command,
        secondary: input.description,
        label: 'Command',
      }

    case 'write':
      return {
        icon: <Pencil size={12} />,
        color: 'var(--color-success)',
        primary: input.file_path || input.path,
        secondary: input.content ? `${input.content.split('\n').length} lines` : null,
        label: 'Write File',
        content: input.content,
      }

    case 'edit':
      return {
        icon: <PenLine size={12} />,
        color: 'var(--color-warning)',
        primary: input.file_path || input.path,
        secondary: null,
        label: 'Edit File',
      }

    case 'read':
      return {
        icon: <BookOpen size={12} />,
        color: 'var(--color-info)',
        primary: input.file_path || input.path,
        secondary: input.limit ? `Lines ${input.offset || 0}-${(input.offset || 0) + input.limit}` : null,
        label: 'Read File',
      }

    case 'glob':
      return {
        icon: <Search size={12} />,
        color: 'var(--color-violet-light)',
        primary: input.pattern,
        secondary: input.path ? `in ${input.path}` : null,
        label: 'Find Files',
      }

    case 'grep':
      return {
        icon: <Search size={12} />,
        color: 'var(--color-violet-light)',
        primary: input.pattern,
        secondary: input.path ? `in ${input.path}` : null,
        label: 'Search Content',
      }

    case 'webfetch':
      return {
        icon: <Globe size={12} />,
        color: 'var(--color-info-vivid)',
        primary: input.url,
        secondary: input.prompt ? `"${input.prompt.slice(0, 50)}..."` : null,
        label: 'Fetch URL',
      }

    case 'websearch':
      return {
        icon: <Search size={12} />,
        color: 'var(--color-info-vivid)',
        primary: input.query,
        secondary: null,
        label: 'Web Search',
      }

    case 'task':
      return {
        icon: <Bot size={12} />,
        color: 'var(--color-pink)',
        primary: input.subagent_type || 'agent',
        secondary: input.prompt ? `"${input.prompt.slice(0, 50)}..."` : null,
        label: 'Launch Agent',
      }

    default:
      return {
        icon: <Settings size={12} />,
        color: 'var(--color-text-secondary)',
        primary: Object.keys(input)[0] ? `${Object.keys(input)[0]}: ${Object.values(input)[0]}` : null,
        secondary: null,
        label: toolName || 'Tool',
      }
  }
}

const QuestionList = ({ input, onInputChange, onClose }) => {
  const questions = Array.isArray(input?.questions) ? input.questions : EMPTY_QUESTIONS
  const [activeIndex, setActiveIndex] = useState(0)
  const [answers, setAnswers] = useState(() => {
    const initial = {}
    questions.forEach((question) => {
      const existing = input?.answers?.[question.question]
      if (typeof existing === 'string' && existing.trim()) {
        initial[question.question] = new Set(existing.split(', ').filter(Boolean))
      } else {
        initial[question.question] = new Set()
      }
    })
    return initial
  })
  const [otherText, setOtherText] = useState({})
  const confirmingRef = useRef(null)
  const [confirming, setConfirming] = useState(null)

  useEffect(() => {
    setAnswers((prev) => {
      const next = {}
      questions.forEach((question) => {
        next[question.question] = prev[question.question] || new Set()
      })
      return next
    })
  }, [questions])

  useEffect(() => {
    if (!questions.length) return
    const nextAnswers = {}
    questions.forEach((question) => {
      const selected = answers[question.question]
      if (!selected || selected.size === 0) return
      const values = Array.from(selected)
      if (values.includes('Other') && otherText[question.question]) {
        const merged = values.filter((value) => value !== 'Other')
        merged.push(otherText[question.question])
        nextAnswers[question.question] = merged.join(', ')
      } else {
        nextAnswers[question.question] = values.join(', ')
      }
    })
    onInputChange?.({
      ...input,
      questions,
      answers: nextAnswers,
    })
  }, [answers, otherText, questions, onInputChange, input])

  useEffect(() => {
    return () => {
      if (confirmingRef.current) {
        clearTimeout(confirmingRef.current)
      }
    }
  }, [])

  if (!questions.length) {
    return <div style={styles.questionEmpty}>No questions provided.</div>
  }

  const currentQuestion = questions[activeIndex]
  const isSelected = (label) => answers[currentQuestion.question]?.has(label)

  const updateSelection = (label) => {
    setAnswers((prev) => {
      const next = { ...prev }
      const selected = new Set(prev[currentQuestion.question] || [])
      if (currentQuestion.multiSelect) {
        if (selected.has(label)) {
          selected.delete(label)
        } else {
          selected.add(label)
        }
      } else {
        selected.clear()
        selected.add(label)
      }
      next[currentQuestion.question] = selected
      return next
    })

    if (!currentQuestion.multiSelect && label !== 'Other' && activeIndex < questions.length - 1) {
      setConfirming(label)
      if (confirmingRef.current) {
        clearTimeout(confirmingRef.current)
      }
      confirmingRef.current = setTimeout(() => {
        setConfirming(null)
        setActiveIndex((prev) => Math.min(prev + 1, questions.length - 1))
      }, 300)
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowLeft' && activeIndex > 0) {
      event.preventDefault()
      setActiveIndex(activeIndex - 1)
    }
    if (event.key === 'ArrowRight' && activeIndex < questions.length - 1) {
      event.preventDefault()
      setActiveIndex(activeIndex + 1)
    }
  }

  return (
    <div style={styles.questionContainer} onKeyDown={handleKeyDown}>
      <div style={styles.questionNav}>
        <div style={styles.questionTabs}>
          {questions.map((question, index) => {
            const hasAnswer = (answers[question.question]?.size || 0) > 0
            return (
              <button
                key={question.question}
                type="button"
                style={{
                  ...styles.questionTab,
                  ...(index === activeIndex ? styles.questionTabActive : {}),
                  ...(hasAnswer ? styles.questionTabAnswered : {}),
                }}
                onClick={() => setActiveIndex(index)}
              >
                {question.header || `Q${index + 1}`}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={onClose} style={styles.questionClose}>
          ×
        </button>
      </div>

      <div style={styles.questionBody}>
        <div style={styles.questionTitle}>{currentQuestion.question}</div>
        <div style={styles.questionOptions}>
          {currentQuestion.options.map((option) => {
            const selected = isSelected(option.label)
            return (
              <button
                key={option.label}
                type="button"
                style={{
                  ...styles.questionOption,
                  ...(selected ? styles.questionOptionSelected : {}),
                  ...(confirming === option.label ? styles.questionOptionConfirming : {}),
                }}
                onClick={() => updateSelection(option.label)}
              >
                <span style={styles.questionOptionControl}>
                  {currentQuestion.multiSelect ? (
                    <span style={{ ...styles.checkbox, ...(selected ? styles.checkboxChecked : {}) }} />
                  ) : (
                    <span style={{ ...styles.radio, ...(selected ? styles.radioChecked : {}) }} />
                  )}
                </span>
                <span style={styles.questionOptionContent}>
                  <span style={styles.questionOptionLabel}>{option.label}</span>
                  {option.description && (
                    <span style={styles.questionOptionDescription}>{option.description}</span>
                  )}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            style={{
              ...styles.questionOption,
              ...(isSelected('Other') ? styles.questionOptionSelected : {}),
              ...(confirming === 'Other' ? styles.questionOptionConfirming : {}),
            }}
            onClick={() => updateSelection('Other')}
          >
            <span style={styles.questionOptionControl}>
              {currentQuestion.multiSelect ? (
                <span style={{ ...styles.checkbox, ...(isSelected('Other') ? styles.checkboxChecked : {}) }} />
              ) : (
                <span style={{ ...styles.radio, ...(isSelected('Other') ? styles.radioChecked : {}) }} />
              )}
            </span>
            <span style={styles.questionOptionContent}>
              <span style={styles.questionOptionLabel}>Other</span>
              {isSelected('Other') && (
                <input
                  type="text"
                  style={styles.otherInput}
                  value={otherText[currentQuestion.question] || ''}
                  placeholder="Type your answer..."
                  onChange={(event) => {
                    const value = event.target.value
                    setOtherText((prev) => ({ ...prev, [currentQuestion.question]: value }))
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

const PermissionPanel = ({
  title,
  options = [],
  selectedIndex = 0,
  onSelect,
  onCustomResponse,
  customPlaceholder = 'Tell Claude what to do instead',
  diff,
  filePath,
  toolName,
  toolInput,
  permissionSuggestions = [],
  blockedPath,
}) => {
  const [customText, setCustomText] = useState('')
  const [editedInput, setEditedInput] = useState(toolInput || {})
  const [destination, setDestination] = useState('session')
  const bashInputRef = useRef(null)

  useEffect(() => {
    setEditedInput(toolInput || {})
  }, [toolInput])

  useEffect(() => {
    const suggestionDestination = permissionSuggestions?.[0]?.destination
    if (DESTINATION_ORDER.includes(suggestionDestination)) {
      setDestination(suggestionDestination)
    } else {
      setDestination('session')
    }
  }, [permissionSuggestions])

  const normalizedTool = normalizeToolName(toolName)
  const isPlanExit = normalizedTool === 'exitplanmode'
  const isAskQuestion = normalizedTool === 'askuserquestion'
  const isBash = normalizedTool === 'bash'

  const canSubmitQuestions = useMemo(() => {
    if (!isAskQuestion) return true
    const questions = editedInput?.questions
    const answers = editedInput?.answers
    if (!Array.isArray(questions) || !answers) return false
    return questions.every((question) => {
      const answer = answers[question.question]
      return typeof answer === 'string' && answer.trim().length > 0
    })
  }, [editedInput, isAskQuestion])

  const suggestionLabel = buildSuggestionLabel(permissionSuggestions, destination, setDestination)
  const suggestionPayload = useMemo(
    () => applySuggestionDestination(permissionSuggestions, destination),
    [permissionSuggestions, destination]
  )

  const computedOptions = useMemo(() => {
    if (options.length > 0) return options
    const hasSuggestions = Array.isArray(permissionSuggestions) && permissionSuggestions.length > 0
    const nextOptions = []
    const primaryLabel = isPlanExit
      ? 'Yes, and auto-accept'
      : isAskQuestion
        ? 'Submit answers'
        : 'Yes'

    nextOptions.push({
      label: primaryLabel,
      decision: 'allow',
      nextMode: isPlanExit ? 'act' : undefined,
      disabled: isAskQuestion && !canSubmitQuestions,
    })

    if (isPlanExit || hasSuggestions) {
      nextOptions.push({
        label: isPlanExit ? 'Yes, and manually approve edits' : suggestionLabel,
        decision: 'allow',
        permissionSuggestions: isPlanExit
          ? [{ type: 'setMode', mode: 'default', destination: 'session' }]
          : suggestionPayload,
        nextMode: isPlanExit ? 'ask' : undefined,
      })
    }

    if (!isAskQuestion) {
      nextOptions.push({
        label: isPlanExit ? 'No, keep planning' : 'No',
        decision: 'deny',
      })
    }

    return nextOptions
  }, [
    options,
    permissionSuggestions,
    isPlanExit,
    isAskQuestion,
    suggestionLabel,
    suggestionPayload,
    canSubmitQuestions,
  ])

  const showCustomInput = !isAskQuestion && computedOptions.some((option) => {
    const decision = String(option.decision || '').toLowerCase()
    return decision === 'deny'
  })

  useEffect(() => {
    if (!isBash || !bashInputRef.current) return
    const command = editedInput?.command || ''
    if (bashInputRef.current.textContent !== command) {
      bashInputRef.current.textContent = command
    }
  }, [editedInput, isBash])

  const display = getToolDisplay(toolName, editedInput)
  const primaryInfo = display.primary || filePath || blockedPath
  const showContent = display.content && !diff
  const effectiveTitle = title || buildPermissionTitle(toolName, editedInput)

  const resolveDecision = (option) => {
    if (option?.decision) return option.decision
    if (typeof option?.label === 'string') {
      const lower = option.label.toLowerCase()
      if (lower.includes('dismiss')) return 'dismiss'
      if (lower.includes('deny') || lower.includes('reject')) return 'deny'
    }
    return 'allow'
  }

  const handleDeny = (option, index) => {
    const reason = customText.trim()
    const message = reason
      ? `${DENY_REASON_PREFIX}${reason}`
      : (isPlanExit ? PLAN_DENY_MESSAGE : DEFAULT_DENY_MESSAGE)
    const payload = {
      ...option,
      index,
      decision: 'deny',
      message,
    }
    onSelect?.(payload)
    if (reason) onCustomResponse?.(reason)
    setCustomText('')
  }

  const handleOptionClick = (option, index) => {
    const decision = resolveDecision(option)
    if (decision === 'dismiss') {
      onSelect?.({ ...option, index, decision })
      return
    }
    if (decision === 'deny') {
      handleDeny(option, index)
      return
    }
    onSelect?.({
      ...option,
      index,
      decision: 'allow',
      updatedInput: editedInput,
      permissionSuggestions: option.permissionSuggestions,
    })
  }

  const handleCustomSubmit = (event) => {
    event.preventDefault()
    if (!customText.trim()) return
    const denyIndex = computedOptions.findIndex(
      (option) => String(option.decision || '').toLowerCase() === 'deny'
    )
    if (denyIndex === -1) return
    handleDeny(computedOptions[denyIndex], denyIndex)
  }

  return (
    <div style={styles.container}>
      {effectiveTitle && <div style={styles.title}>{effectiveTitle}</div>}

      {!isAskQuestion && (toolName || primaryInfo) && (
        <div style={styles.toolInfo}>
          <span style={{ ...styles.toolBadge, backgroundColor: display.color }}>
            <span style={styles.toolIcon}>{display.icon}</span>
            {display.label}
          </span>
          {!isBash && primaryInfo && <span style={styles.primaryInfo}>{primaryInfo}</span>}
        </div>
      )}

      {isBash && (
        <div style={styles.bashCommand}>
          <div
            ref={bashInputRef}
            style={styles.bashCommandInput}
            contentEditable
            spellCheck={false}
            onInput={(event) => {
              const nextCommand = event.currentTarget.textContent || ''
              setEditedInput((prev) => ({ ...prev, command: nextCommand }))
            }}
          />
          {display.secondary && (
            <div style={styles.secondaryInfo}>{display.secondary}</div>
          )}
        </div>
      )}

      {isAskQuestion && (
        <QuestionList
          input={editedInput}
          onInputChange={setEditedInput}
          onClose={() => handleDeny({ decision: 'deny' }, computedOptions.length - 1)}
        />
      )}

      {!isAskQuestion && !isBash && display.secondary && (
        <div style={styles.secondaryInfo}>{display.secondary}</div>
      )}

      {diff && <DiffViewer diff={diff} />}
      {showContent && <CodeBlock content={display.content} />}

      <div style={styles.options}>
        {computedOptions.map((option, index) => {
          const isDisabled = Boolean(option.disabled)
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleOptionClick(option, index)}
              disabled={isDisabled}
              style={{
                ...styles.option,
                ...(index === selectedIndex ? styles.optionSelected : {}),
                ...(isDisabled ? styles.optionDisabled : {}),
              }}
            >
              <span style={styles.optionNumber}>{index + 1}</span>
              <span style={styles.optionLabel}>{option.label}</span>
            </button>
          )
        })}
      </div>

      {showCustomInput && (
        <form onSubmit={handleCustomSubmit} style={styles.customForm}>
          <input
            type="text"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            placeholder={customPlaceholder}
            style={styles.customInput}
          />
        </form>
      )}
    </div>
  )
}

export default PermissionPanel
