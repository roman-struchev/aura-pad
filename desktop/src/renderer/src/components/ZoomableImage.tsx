import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'

// The one viewing surface behind the image viewer, the SVG preview and the
// PlantUML preview: fit-to-pane by default (never enlarged past 100%), zoom by
// buttons or Cmd+wheel / trackpad pinch, scroll once it outgrows the pane.

type Zoom = 'fit' | number

const MIN_SCALE = 0.05
const MAX_SCALE = 32
const STEP = 1.25
// Breathing room around a fitted image, so it doesn't touch the pane edges.
const PADDING = 16

const clamp = (n: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))

// Two theme tokens rather than fixed greys, so transparency reads as a
// checkerboard in all four themes and never as the theme's own background.
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--fleet-border) 25%, var(--fleet-bg) 0 50%, var(--fleet-border) 0 75%, var(--fleet-bg) 0)',
  backgroundSize: '16px 16px'
}

interface ZoomableImageProps {
  src: string
  alt: string
  checkerboard?: boolean
  // Appended to the "W × H" readout, e.g. the file size.
  extraInfo?: string
  onError?: () => void
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  checkerboard,
  extraInfo,
  onError
}) => {
  const paneRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState<Zoom>('fit')
  // Where the cursor was, as a fraction of the content, when a wheel zoom
  // started - so the point under it stays put once the new size is laid out.
  const anchorRef = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)

  // Measured right away as well as on resize: ResizeObserver only reports
  // during a rendering step, which a window that isn't on screen may not get
  // for a while - and until then Fit would think the pane has no size.
  useLayoutEffect(() => {
    const el = paneRef.current
    if (!el) return
    const measure = (): void => setPane({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // An SVG with no width/height of its own has no natural size: it just
  // fills the pane at Fit, and zoom scales that.
  const sized = natural.w > 0 && natural.h > 0
  const base = sized
    ? natural
    : { w: Math.max(1, pane.w - PADDING * 2), h: Math.max(1, pane.h - PADDING * 2) }
  const fitScale =
    sized && pane.w > 0 && pane.h > 0
      ? Math.min(1, (pane.w - PADDING * 2) / base.w, (pane.h - PADDING * 2) / base.h)
      : 1
  const scale = zoom === 'fit' ? Math.max(MIN_SCALE, fitScale) : zoom

  const zoomTo = (next: number): void => setZoom(clamp(next))
  // The wheel handler is bound once; it reads the live scale from here.
  const currentScaleRef = useRef(scale)
  useEffect(() => {
    currentScaleRef.current = scale
  })

  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    // Native and non-passive: React's onWheel can't preventDefault, and
    // without it a pinch would also zoom the whole page.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      anchorRef.current = {
        fx: (el.scrollLeft + mx) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + my) / Math.max(1, el.scrollHeight),
        mx,
        my
      }
      // Pinch deltas are small and fine-grained, wheel notches large: an
      // exponential keeps both proportional.
      const factor = Math.exp(-e.deltaY * 0.01)
      setZoom((z) => clamp((z === 'fit' ? currentScaleRef.current : z) * factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useLayoutEffect(() => {
    const el = paneRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    anchorRef.current = null
    el.scrollLeft = anchor.fx * el.scrollWidth - anchor.mx
    el.scrollTop = anchor.fy * el.scrollHeight - anchor.my
  }, [scale])

  const width = Math.round(base.w * scale)
  const height = Math.round(base.h * scale)
  const percent = `${Math.round(scale * 100)}%`
  const info = [sized ? `${natural.w} × ${natural.h}` : null, extraInfo].filter(Boolean).join(' · ')
  const button =
    'flex items-center justify-center h-6 min-w-6 px-1 rounded text-gray-500 hover:text-fleet-textHover hover:bg-fleet-active'

  return (
    <div className="relative h-full w-full">
      <div ref={paneRef} className="h-full w-full overflow-auto" data-testid="image-pane">
        <div
          className="flex items-center justify-center"
          style={{
            minWidth: '100%',
            minHeight: '100%',
            width: width + PADDING * 2,
            height: height + PADDING * 2
          }}
        >
          <img
            src={src}
            alt={alt}
            data-testid="zoomable-image"
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={onError}
            style={{
              width,
              height,
              maxWidth: 'none',
              // Pixel art and icons stay crisp when zoomed in.
              imageRendering: scale > 2 ? 'pixelated' : 'auto',
              ...(checkerboard ? CHECKERBOARD : {})
            }}
          />
        </div>
      </div>

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
        <span
          data-testid="image-info"
          className="truncate rounded-md bg-fleet-header/80 px-2 py-0.5 text-[11px] text-fleet-text backdrop-blur-sm"
        >
          {info || ' '}
        </span>
        <div className="flex items-center gap-0.5 rounded-md bg-fleet-header/80 px-0.5 py-0.5 text-[11px] backdrop-blur-sm pointer-events-auto">
          <button
            className={button}
            aria-label="Zoom Out"
            title="Zoom Out (Cmd+wheel)"
            onClick={() => zoomTo(scale / STEP)}
          >
            <ZoomOut size={14} />
          </button>
          <span
            data-testid="zoom-percent"
            className="w-11 text-center text-fleet-text tabular-nums"
          >
            {percent}
          </span>
          <button
            className={button}
            aria-label="Zoom In"
            title="Zoom In (Cmd+wheel)"
            onClick={() => zoomTo(scale * STEP)}
          >
            <ZoomIn size={14} />
          </button>
          <button
            className={button}
            aria-label="Fit"
            title="Fit to Window"
            onClick={() => setZoom('fit')}
          >
            <Maximize size={14} />
          </button>
          <button
            className={button}
            aria-label="Actual Size"
            title="Actual Size (1:1)"
            onClick={() => setZoom(1)}
          >
            1:1
          </button>
        </div>
      </div>
    </div>
  )
}
