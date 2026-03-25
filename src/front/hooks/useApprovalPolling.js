/**
 * useApprovalPolling — polls for pending tool approval requests.
 *
 * Extracted from App.jsx to isolate the approval concern.
 * Returns the current approval list and decision handler.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether approval feature is enabled
 * @param {string} options.projectRoot - Project root for path normalization
 * @returns {{ approvals: Array, approvalsLoaded: boolean, handleDecision: Function, normalizeApprovalPath: Function, getReviewTitle: Function }}
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiFetchJson } from '../utils/transport'
import routes from '../utils/routes'

function getFileName(path) {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export default function useApprovalPolling({ enabled = false, projectRoot = '' } = {}) {
  const [approvals, setApprovals] = useState([])
  const [approvalsLoaded, setApprovalsLoaded] = useState(false)
  const dismissedRef = useRef(new Set())

  // Poll for pending approvals
  useEffect(() => {
    if (!enabled) {
      setApprovals([])
      setApprovalsLoaded(true)
      return
    }

    let isActive = true

    const fetchApprovals = () => {
      const route = routes.approval.pending()
      apiFetchJson(route.path, { query: route.query })
        .then(({ data }) => {
          if (!isActive) return
          const requests = Array.isArray(data.requests) ? data.requests : []
          const filtered = requests.filter(
            (req) => !dismissedRef.current.has(req.id),
          )
          setApprovals(filtered)
          setApprovalsLoaded(true)
        })
        .catch(() => {})
    }

    fetchApprovals()
    const interval = setInterval(fetchApprovals, 1000)

    return () => {
      isActive = false
      clearInterval(interval)
    }
  }, [enabled])

  // Submit a decision (approve/deny) for a request
  const handleDecision = useCallback(
    async (requestId, decision, reason, dockApi) => {
      if (requestId) {
        dismissedRef.current.add(requestId)
        setApprovals((prev) => prev.filter((req) => req.id !== requestId))
        if (dockApi) {
          const panel = dockApi.getPanel(`review-${requestId}`)
          if (panel) {
            panel.api.close()
          }
        }
      } else {
        setApprovals([])
      }
      try {
        const route = routes.approval.decision()
        await apiFetch(route.path, {
          query: route.query,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId, decision, reason }),
        })
      } catch {
        // Ignore decision errors; UI already dismissed.
      }
    },
    [],
  )

  // Normalize approval path relative to project root
  const normalizeApprovalPath = useCallback(
    (approval) => {
      if (!approval) return ''
      if (approval.project_path) return approval.project_path
      const filePath = approval.file_path || ''
      if (!filePath) return ''
      if (projectRoot) {
        const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
        if (filePath.startsWith(root)) {
          return filePath.slice(root.length)
        }
      }
      return filePath
    },
    [projectRoot],
  )

  // Generate a review panel title for an approval
  const getReviewTitle = useCallback(
    (approval) => {
      const approvalPath = normalizeApprovalPath(approval)
      if (approvalPath) {
        return `Review: ${getFileName(approvalPath)}`
      }
      if (approval?.tool_name) {
        return `Review: ${approval.tool_name}`
      }
      return 'Review'
    },
    [normalizeApprovalPath],
  )

  return {
    approvals,
    approvalsLoaded,
    handleDecision,
    normalizeApprovalPath,
    getReviewTitle,
  }
}
