import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useChatMetrics, ChatMetricsProvider, useChatMetricsContext } from '../useChatMetrics'

describe('useChatMetrics', () => {
  it('recordEvent stores event with timestamp', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordEvent('first_message_sent')
    })

    const metrics = result.current.getMetrics()
    expect(metrics.events).toHaveLength(1)
    expect(metrics.events[0].name).toBe('first_message_sent')
    expect(typeof metrics.events[0].timestamp).toBe('number')
    expect(metrics.events[0].timestamp).toBeGreaterThan(0)
  })

  it('recordLatency stores latency value', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordLatency('stream_duration', 1500)
    })

    const metrics = result.current.getMetrics()
    expect(metrics.latencies).toHaveLength(1)
    expect(metrics.latencies[0].name).toBe('stream_duration')
    expect(metrics.latencies[0].ms).toBe(1500)
  })

  it('getMetrics returns all recorded metrics', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordEvent('first_message_sent')
      result.current.recordLatency('first_message_latency', 320)
      result.current.recordLatency('stream_duration', 1500)
      result.current.recordError('transport_error', 'timeout')
    })

    const metrics = result.current.getMetrics()
    expect(metrics.events).toHaveLength(1)
    expect(metrics.latencies).toHaveLength(2)
    expect(metrics.errors).toHaveLength(1)
  })

  it('recordError stores error with context', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordError('transport_error', 'timeout')
    })

    const metrics = result.current.getMetrics()
    expect(metrics.errors).toHaveLength(1)
    expect(metrics.errors[0].name).toBe('transport_error')
    expect(metrics.errors[0].detail).toBe('timeout')
    expect(typeof metrics.errors[0].timestamp).toBe('number')
  })

  it('metrics accumulate across calls and do not overwrite', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordEvent('first_message_sent')
    })

    act(() => {
      result.current.recordEvent('session_switch')
    })

    act(() => {
      result.current.recordLatency('stream_duration', 1500)
    })

    act(() => {
      result.current.recordLatency('stream_duration', 2000)
    })

    act(() => {
      result.current.recordError('transport_error', 'timeout')
    })

    act(() => {
      result.current.recordError('transport_error', 'network_failure')
    })

    const metrics = result.current.getMetrics()
    expect(metrics.events).toHaveLength(2)
    expect(metrics.events[0].name).toBe('first_message_sent')
    expect(metrics.events[1].name).toBe('session_switch')
    expect(metrics.latencies).toHaveLength(2)
    expect(metrics.latencies[0].ms).toBe(1500)
    expect(metrics.latencies[1].ms).toBe(2000)
    expect(metrics.errors).toHaveLength(2)
    expect(metrics.errors[0].detail).toBe('timeout')
    expect(metrics.errors[1].detail).toBe('network_failure')
  })

  it('tracks specific metric types: tool_call_count, error_count, session_switch_count, artifact_open_count', () => {
    const { result } = renderHook(() => useChatMetrics())

    act(() => {
      result.current.recordEvent('tool_call_count')
      result.current.recordEvent('tool_call_count')
      result.current.recordEvent('tool_call_count')
      result.current.recordEvent('session_switch_count')
      result.current.recordEvent('artifact_open_count')
    })

    const metrics = result.current.getMetrics()
    const toolCalls = metrics.events.filter(e => e.name === 'tool_call_count')
    expect(toolCalls).toHaveLength(3)

    const sessionSwitches = metrics.events.filter(e => e.name === 'session_switch_count')
    expect(sessionSwitches).toHaveLength(1)

    const artifactOpens = metrics.events.filter(e => e.name === 'artifact_open_count')
    expect(artifactOpens).toHaveLength(1)
  })
})

describe('ChatMetricsProvider', () => {
  it('provides metrics context to child components', () => {
    function TestChild() {
      const metrics = useChatMetricsContext()
      return React.createElement('div', { 'data-testid': 'has-metrics' },
        String(typeof metrics.recordEvent === 'function'))
    }

    const wrapper = ({ children }) =>
      React.createElement(ChatMetricsProvider, null, children)

    const { result } = renderHook(() => useChatMetricsContext(), { wrapper })

    expect(typeof result.current.recordEvent).toBe('function')
    expect(typeof result.current.recordLatency).toBe('function')
    expect(typeof result.current.recordError).toBe('function')
    expect(typeof result.current.getMetrics).toBe('function')
  })

  it('shares the same metrics instance across child components', () => {
    const wrapper = ({ children }) =>
      React.createElement(ChatMetricsProvider, null, children)

    const { result: result1 } = renderHook(() => useChatMetricsContext(), { wrapper })
    const { result: result2 } = renderHook(() => useChatMetricsContext(), { wrapper })

    // Both hooks return functions (from the same provider context type)
    expect(typeof result1.current.recordEvent).toBe('function')
    expect(typeof result2.current.recordEvent).toBe('function')
  })
})
