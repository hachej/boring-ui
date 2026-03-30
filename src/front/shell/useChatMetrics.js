/**
 * useChatMetrics — lightweight in-memory metrics hook for chat transport instrumentation.
 *
 * Tracks:
 *   - first_message_latency: time from send to first text-delta
 *   - stream_duration: time from first chunk to finish
 *   - tool_call_count: number of tool calls per message
 *   - error_count: transport errors
 *   - session_switch_count: session switches
 *   - artifact_open_count: artifacts opened
 *
 * Exposes: recordEvent, recordLatency, recordError, getMetrics
 *
 * v1: metrics stored in-memory only. Pipeline integration is a follow-up.
 */

import { useRef, createContext, useContext, createElement } from 'react'

/**
 * @typedef {{ name: string, timestamp: number }} MetricEvent
 * @typedef {{ name: string, ms: number, timestamp: number }} MetricLatency
 * @typedef {{ name: string, detail: string, timestamp: number }} MetricError
 * @typedef {{ events: MetricEvent[], latencies: MetricLatency[], errors: MetricError[] }} Metrics
 */

/**
 * Creates a new metrics store (plain object, no React state — avoids re-renders on metric writes).
 * @returns {object} metrics API
 */
function createMetricsStore() {
  /** @type {MetricEvent[]} */
  const events = []
  /** @type {MetricLatency[]} */
  const latencies = []
  /** @type {MetricError[]} */
  const errors = []

  /**
   * Record a named event with a timestamp.
   * @param {string} name
   */
  function recordEvent(name) {
    events.push({ name, timestamp: Date.now() })
  }

  /**
   * Record a named latency measurement.
   * @param {string} name
   * @param {number} ms
   */
  function recordLatency(name, ms) {
    latencies.push({ name, ms, timestamp: Date.now() })
  }

  /**
   * Record a named error with descriptive detail.
   * @param {string} name
   * @param {string} detail
   */
  function recordError(name, detail) {
    errors.push({ name, detail, timestamp: Date.now() })
  }

  /**
   * Return a snapshot of all recorded metrics.
   * @returns {Metrics}
   */
  function getMetrics() {
    return {
      events: [...events],
      latencies: [...latencies],
      errors: [...errors],
    }
  }

  return { recordEvent, recordLatency, recordError, getMetrics }
}

/**
 * React hook that provides a stable metrics API for the lifetime of the component.
 *
 * Metrics are stored in a ref to avoid unnecessary re-renders — recording a metric
 * is a fire-and-forget side-effect, not something the UI needs to react to.
 */
export function useChatMetrics() {
  const storeRef = useRef(null)
  if (storeRef.current === null) {
    storeRef.current = createMetricsStore()
  }
  return storeRef.current
}

/**
 * Context for sharing a single metrics instance across the ChatStage component tree.
 */
const ChatMetricsContext = createContext(null)

/**
 * Provider component that wraps ChatStage and makes metrics available to all children.
 * Uses createElement instead of JSX to keep this a .js file.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function ChatMetricsProvider({ children }) {
  const metrics = useChatMetrics()
  return createElement(ChatMetricsContext.Provider, { value: metrics }, children)
}

/**
 * Consume metrics from the nearest ChatMetricsProvider.
 *
 * @returns {{ recordEvent: Function, recordLatency: Function, recordError: Function, getMetrics: Function }}
 * @throws {Error} if used outside ChatMetricsProvider
 */
export function useChatMetricsContext() {
  const ctx = useContext(ChatMetricsContext)
  if (ctx === null) {
    throw new Error('useChatMetricsContext must be used within a ChatMetricsProvider')
  }
  return ctx
}
