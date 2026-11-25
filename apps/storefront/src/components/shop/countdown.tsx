import { useEffect, useState } from 'react';

const pad = (n: number) => n.toString().padStart(2, '0');

/** Time left until `until`, updated every second ("02:14:09"; days shown when over a day). */
export function Countdown({ until, className }: { until: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <time
      dateTime={until}
      className={className}
      aria-label={`Ends in ${days} days ${hours} hours ${minutes} minutes`}
    >
      {days > 0 ? `${days}d ` : ''}
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </time>
  );
}
