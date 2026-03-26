import { useReducer, useEffect, useCallback } from 'react'
import type { Room, DecryptedMessage } from '../lib/Room'

interface State {
  messages: DecryptedMessage[]
  loading: boolean
}

type Action =
  | { type: 'loaded'; messages: DecryptedMessage[] }
  | { type: 'load-failed' }
  | { type: 'append'; message: DecryptedMessage }
  | { type: 'prepend'; messages: DecryptedMessage[] }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { messages: action.messages, loading: false }
    case 'load-failed':
      return { ...state, loading: false }
    case 'append':
      return { ...state, messages: [...state.messages, action.message] }
    case 'prepend':
      return { ...state, messages: [...action.messages, ...state.messages] }
  }
}

export function useMessages(room: Room | null) {
  const [{ messages, loading }, dispatch] = useReducer(reducer, {
    messages: [],
    loading: room !== null,
  })

  useEffect(() => {
    if (!room) return

    // Initial load — all state changes happen inside async callbacks
    room
      .getMessages()
      .then((initial) => dispatch({ type: 'loaded', messages: initial }))
      .catch(() => dispatch({ type: 'load-failed' }))

    // Real-time updates
    const onNewMessage = (msg: DecryptedMessage) => {
      dispatch({ type: 'append', message: msg })
    }
    room.on('new-message', onNewMessage as (...args: unknown[]) => void)
    return () => room.off('new-message', onNewMessage as (...args: unknown[]) => void)
  }, [room])

  const loadMore = useCallback(() => {
    if (!room || messages.length === 0) return Promise.resolve()
    const oldest = messages[0].sentAt
    return room
      .getMessages({ before: oldest })
      .then((older) => dispatch({ type: 'prepend', messages: older }))
      .catch(() => {})
  }, [room, messages])

  return { messages, loading, loadMore }
}
