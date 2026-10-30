import React, { useEffect, useRef } from 'react'

// Scrolling waveform of the live mic level while dictating (Voice Memos
// style): a mirrored envelope around a center line, new audio entering on the
// right. Doubles as diagnostics - a flat line means the mic isn't picking
// anything up. Drawn on a small canvas from a requestAnimationFrame loop;
// going through React state at ~60fps would re-render the whole app for a
// cosmetic animation. Inherits its color from CSS `color` on the canvas, so
// the parent's text-* class picks the accent.
const WIDTH = 56
const HEIGHT = 16
const STEP = 2 // px per history sample
const POINTS = WIDTH / STEP

export const VoiceLevelMeter: React.FC<{ analyser: AnalyserNode }> = ({ analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = getComputedStyle(canvas).color

    const samples = new Uint8Array(analyser.fftSize)
    const history = new Float32Array(POINTS)
    let smoothed = 0
    let frame = 0
    let raf: number

    const tick = (): void => {
      // RMS of the time-domain signal = perceived loudness of this frame,
      // manually smoothed (smoothingTimeConstant only affects frequency data).
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128
        sum += v * v
      }
      smoothed = smoothed * 0.6 + Math.sqrt(sum / samples.length) * 0.4
      // Scroll every 4th frame (~15 samples/s, so the visible window covers
      // ~2s of audio) - at full 60fps the wave rushed by distractingly fast.
      // The current rightmost sample still updates every frame, so the wave
      // reacts to the voice with no perceptible lag.
      if (frame++ % 4 === 0) history.copyWithin(0, 1)
      history[POINTS - 1] = Math.min(1, smoothed * 4.5)

      const mid = HEIGHT / 2
      const amp = (i: number): number => Math.max(0.8, history[i] * (mid - 1))
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.beginPath()
      for (let i = 0; i < POINTS; i++) ctx.lineTo(i * STEP, mid - amp(i))
      for (let i = POINTS - 1; i >= 0; i--) ctx.lineTo(i * STEP, mid + amp(i))
      ctx.closePath()
      ctx.fill()
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return <canvas ref={canvasRef} style={{ width: WIDTH, height: HEIGHT }} className="block" />
}
