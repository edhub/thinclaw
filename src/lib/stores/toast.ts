/**
 * Minimal toast store.
 * Usage: toast.show('已保存')  /  toast.show('出错了', 'error')
 */
import { writable } from 'svelte/store'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

function createToastStore() {
  const { subscribe, update } = writable<ToastItem[]>([])
  let _id = 0

  function show(message: string, kind: ToastKind = 'success', duration = 2800) {
    const id = ++_id
    update((list) => [...list, { id, message, kind }])
    setTimeout(() => dismiss(id), duration)
  }

  function dismiss(id: number) {
    update((list) => list.filter((t) => t.id !== id))
  }

  return { subscribe, show, dismiss }
}

export const toast = createToastStore()
