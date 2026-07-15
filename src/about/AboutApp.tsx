import { useState } from 'react';
import AppShell from '../ios/AppShell';
import { Button, Squircle } from '../ios';
import { BIO, SKILLS, POSTS, FORMSPREE_ENDPOINT } from './data';
import './about.css';

type SendState = 'idle' | 'sending' | 'success' | 'error';

export default function AboutApp() {
  return (
    <AppShell title="About Me" glyph="👋" maxWidth={720}>
      <ProfileHeader />

      <Section title="About">
        <div className="ios-card about-card">
          {BIO.map((p, i) => (
            <p key={i} className="about-bio">{p}</p>
          ))}
        </div>
      </Section>

      <Section title="Skills">
        <div className="about-chips">
          {SKILLS.map((s) => (
            <span key={s} className="about-chip">{s}</span>
          ))}
        </div>
      </Section>

      <Section title="Résumé">
        <a className="ios-card about-link-row" href="/printer/">
          <span className="about-link-icon" style={{ background: 'linear-gradient(160deg,#30d0c6,#0a9d9f)' }}>🖨️</span>
          <span className="about-link-text">
            <span className="about-link-title">View my résumé</span>
            <span className="about-link-sub">Opens in the Printer app</span>
          </span>
          <Chevron />
        </a>
      </Section>

      <Section title="Writing">
        <Squircle radius={22} className="ios-card about-posts">
          {POSTS.map((post, i) => (
            <a
              key={post.id}
              className="about-post"
              href={post.url}
              style={{ borderTop: i === 0 ? 'none' : undefined }}
            >
              <div className="about-post-head">
                <span className="about-post-title">{post.title}</span>
                <span className="about-post-date">{post.date}</span>
              </div>
              <p className="about-post-excerpt">{post.excerpt}</p>
              <div className="about-post-tags">
                {post.tags.map((t) => (
                  <span key={t} className="about-tag">{t}</span>
                ))}
              </div>
            </a>
          ))}
        </Squircle>
      </Section>

      <Section title="Get in touch">
        <ContactForm />
      </Section>
    </AppShell>
  );
}

function ProfileHeader() {
  return (
    <header className="about-profile">
      <Squircle radius={Infinity} className="about-avatar">
        <span aria-hidden>HC</span>
      </Squircle>
      <div className="about-profile-text">
        <h1>Hastin Chen</h1>
        <p>Aspiring Software Developer</p>
      </div>
    </header>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="about-section">
      <h2 className="about-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Chevron() {
  return (
    <svg className="about-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [state, setState] = useState<SendState>('idle');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setState('success');
        setForm({ name: '', email: '', message: '' });
        setTimeout(() => setState('idle'), 5000);
      } else {
        setState('error');
        setTimeout(() => setState('idle'), 5000);
      }
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="ios-card about-form" onSubmit={onSubmit}>
      <label className="ios-field-label" htmlFor="c-name">Name</label>
      <input id="c-name" className="ios-input" value={form.name} onChange={set('name')} required placeholder="Your name" />

      <label className="ios-field-label" htmlFor="c-email">Email</label>
      <input id="c-email" type="email" className="ios-input" value={form.email} onChange={set('email')} required placeholder="you@example.com" />

      <label className="ios-field-label" htmlFor="c-msg">Message</label>
      <textarea id="c-msg" className="ios-input about-textarea" rows={4} value={form.message} onChange={set('message')} required placeholder="Say hello…" />

      <div className="about-form-actions">
        <Button type="submit" variant="primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : state === 'success' ? '✓ Sent!' : 'Send Message'}
        </Button>
        {state === 'error' && <span className="about-form-msg err">Something went wrong. Try again.</span>}
        {state === 'success' && <span className="about-form-msg ok">Thanks! I'll get back to you soon.</span>}
      </div>
    </form>
  );
}
