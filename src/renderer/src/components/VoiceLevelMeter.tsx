import React, { useEffect, useRef } from 'react'

// Five equalizer bars driven by the live mic spectrum while dictating -
// instant feedback that the mic is actually picking the voice up (flat bars
// = wrong input device / muted mic). Bar heights are written straight to the
// DOM from a requestAnimationFrame loop; going through React state at ~60fps
// would re-render the whole app for a cosmetic animation.
const BAR_COUNT = 5
// Analyser bins to sample, low to high. With fftSize 64 at the default 48kHz
// context rate each bin is ~750Hz wide, so these cover the voice range while
// skipping bin 0 (DC offset/rumble, which would pin the first bar).
const BINS = [1, 2, 3, 5, 7]
const MIN_HEIGHT = 3
const MAX_HEIGHT = 14

export const VoiceLevelMeter: React.FC<{ analyser: AnalyserNode }> = ({ analyser }) => {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf: number
    const tick = (): void => {
      analyser.getByteFrequencyData(data)
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const level = data[BINS[i]] / 255
        bar.style.height = `${MIN_HEIGHT + level * (MAX_HEIGHT - MIN_HEIGHT)}px`
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <span className="flex items-center gap-[2px] h-4">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[2px] rounded-full bg-red-500 transition-[height] duration-75"
          style={{ height: `${MIN_HEIGHT}px` }}
        />
      ))}
    </span>
  )
}
