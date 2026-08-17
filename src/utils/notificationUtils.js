/**
 * Toca um som de notificação sutil e mostra notificação do browser.
 */
export function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    // Ding-dong
    osc.frequency.setValueAtTime(587, ctx.currentTime)       // D5
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.15) // G5
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    // silently fail if AudioContext not available
  }
}

export async function showBrowserNotification(title, body) {
  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.svg' })
    }
  } catch {
    // silently fail
  }
}
