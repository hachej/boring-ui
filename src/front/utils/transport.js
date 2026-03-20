import { buildApiUrl, buildWsUrl } from './apiBase'

const parseJsonResponse = async (response) => {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export const apiFetch = (path, options = {}) => {
  const { query, rootScoped = false, ...init } = options
  return fetch(buildApiUrl(path, query, { rootScoped }), { credentials: 'include', ...init })
}

export const apiFetchJson = async (path, options = {}) => {
  const response = await apiFetch(path, options)
  const data = await parseJsonResponse(response)
  return { response, data }
}

export const apiFetchText = async (path, options = {}) => {
  const response = await apiFetch(path, options)
  const data = await response.text().catch(() => '')
  return { response, data }
}

export const getHttpErrorDetail = (response, data, fallback = 'Request failed') =>
  data?.detail || data?.message || `${fallback} (${response.status})`

export const openWebSocket = (path, options = {}) => {
  const { query } = options
  return new WebSocket(buildWsUrl(path, query))
}

export const fetchUrl = (url, options = {}) => {
  const init = { ...options }
  delete init.query
  return fetch(url, init)
}

export const fetchJsonUrl = async (url, options = {}) => {
  const response = await fetchUrl(url, options)
  const data = await parseJsonResponse(response)
  return { response, data }
}

export const openWebSocketUrl = (url) => new WebSocket(url)
