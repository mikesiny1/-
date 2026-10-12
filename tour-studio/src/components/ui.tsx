import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  plan: (
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M3 11h7v10M14 3v8h7" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-8 8" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  arrow: <path d="M14 6l-6 6 6 6" />,
  arrowL: <path d="M10 6l6 6-6 6" />,
  download: <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" />,
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  chat: <path d="M4 20l1.4-4A8 8 0 1 1 9 19.3z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  sofa: <path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h3v4h12v-4h3v6H3zM5 17v2M19 17v2" />,
  cube: (
    <>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="M9 21l2.5-6.5L14 16v5M7 12l3-4h4l2.5 3.5L19 12M11.5 14.5 12.5 9" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  ruler: <path d="M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />,
  wand: <path d="M4 20 15 9M14 4v3M19 9h-3M17.5 5.5l-2 2M11 6l1 1M18 12l-1-1" />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="m3 16 5-5 5 5 3-3 5 5" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};

export function Icon({ name, size }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size || 16}
      height={size || 16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={'field ' + (props.className || '')}>
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function Seg<T extends string>(props: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {props.options.map((o) => (
        <button key={o.id} className={o.id === props.value ? 'on' : ''} onClick={() => props.onChange(o.id)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <span className={'switch' + (props.on ? ' on' : '')} onClick={() => props.onChange(!props.on)} role="switch" aria-checked={props.on}>
      <i />
      {props.children}
    </span>
  );
}

export function Range(props: { label: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="range">
      <span>{props.label}</span>
      <b>{props.fmt ? props.fmt(props.value) : props.value}</b>
      <input type="range" min={props.min} max={props.max} step={props.step || 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

export function Drop(props: { accept: string; multiple?: boolean; icon: string; title: string; text: string; cta: string; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={'drop' + (over ? ' over' : '')}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
        if (files.length) props.onFiles(files);
      }}
    >
      <div className="ic">
        <Icon name={props.icon} />
      </div>
      <div>
        <h3>{props.title}</h3>
        <p>{props.text}</p>
      </div>
      <span className="btn ghost sm">{props.cta}</span>
      <input
        ref={ref}
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          if (files.length) props.onFiles(files);
        }}
      />
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};
