import { useMemo, useState } from 'react';

/**
 * Deterministic gradient + initial from the handle, so each account keeps its
 * own colour everywhere it appears.
 *
 * No stored profile pictures on purpose: Instagram's URLs are signed and expire
 * within days, so persisting them would churn a few hundred KB into every daily
 * commit and still 404 by the time anyone looked. The one exception is `src` —
 * a picture the local agent fetched live, which the profile sheet passes in.
 */
export default function Avatar({
  username,
  src,
  className = 'ig-avatar',
}: {
  username: string;
  src?: string | null;
  className?: string;
}) {
  const { hue, initial } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < username.length; i++) acc = (acc * 31 + username.charCodeAt(i)) % 360;
    // Plenty of handles start with . or _ — skip to the first real character so
    // the avatar doesn't just show punctuation.
    const letter = [...username].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? username.slice(0, 1);
    return { hue: acc, initial: letter.toUpperCase() };
  }, [username]);

  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    return <img className={className} src={src} alt="" onError={() => setBroken(true)} />;
  }

  return (
    <span
      className={className}
      aria-hidden
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 72% 62%), hsl(${(hue + 42) % 360} 68% 46%))`,
      }}
    >
      {initial}
    </span>
  );
}
