import { useState, useRef } from 'react';
import SectionReveal from '../ui/SectionReveal';
import MagneticButton from '../ui/MagneticButton';
import type { ContactFormData } from '../../types';

/**
 * ============================================
 * TODO: Replace FORMSPREE_ENDPOINT below with
 * your actual Formspree form endpoint.
 *
 * Steps:
 *   1. Go to https://formspree.io
 *   2. Create a free account
 *   3. Create a new form
 *   4. Copy the form endpoint URL
 *   5. Replace the placeholder below
 *
 * Example: "https://formspree.io/f/xyzabcde"
 * ============================================
 */
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID';

export default function Contact() {
  const [formData, setFormData] = useState<ContactFormData>({
    name: '',
    email: '',
    message: '',
  });
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const formRef = useRef<HTMLFormElement>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setStatus('success');
        setFormData({ name: '', email: '', message: '' });
        setTimeout(() => setStatus('idle'), 5000);
      } else {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 5000);
      }
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  return (
    <section id="contact" className="relative z-10 section-padding mobile-snap-section">
      <div className="max-w-4xl mx-auto content-backdrop">
        <SectionReveal className="text-center mb-16">
          <span className="text-sm font-mono uppercase tracking-[0.3em] text-[var(--color-primary-green)] mb-4 block">
            Get In Touch
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold">
            Let's <span className="gradient-text">Connect</span>
          </h2>
          <p className="text-[var(--color-text-secondary)] mt-4 max-w-xl mx-auto">
            Have a question, want to collaborate, or just want to say hi? 
            Drop me a message and I'll get back to you.
          </p>
        </SectionReveal>

        <SectionReveal direction="up">
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="glass-card p-8 md:p-12 space-y-8"
          >
            {/* Name */}
            <div className="relative group">
              <input
                type="text"
                id="contact-name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder=" "
                className="peer w-full bg-transparent border-b-2 border-[var(--color-glass-border)]
                  focus:border-[var(--color-primary-green)] outline-none
                  py-3 text-[var(--color-text-primary)] transition-colors duration-300
                  placeholder-transparent"
                data-cursor-hover
              />
              <label
                htmlFor="contact-name"
                className="absolute left-0 top-3 text-sm text-[var(--color-text-muted)]
                  transition-all duration-300 pointer-events-none
                  peer-focus:-top-3 peer-focus:text-xs peer-focus:text-[var(--color-primary-green)]
                  peer-not-placeholder-shown:-top-3 peer-not-placeholder-shown:text-xs"
              >
                Your Name
              </label>
            </div>

            {/* Email */}
            <div className="relative group">
              <input
                type="email"
                id="contact-email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder=" "
                className="peer w-full bg-transparent border-b-2 border-[var(--color-glass-border)]
                  focus:border-[var(--color-primary-green)] outline-none
                  py-3 text-[var(--color-text-primary)] transition-colors duration-300
                  placeholder-transparent"
                data-cursor-hover
              />
              <label
                htmlFor="contact-email"
                className="absolute left-0 top-3 text-sm text-[var(--color-text-muted)]
                  transition-all duration-300 pointer-events-none
                  peer-focus:-top-3 peer-focus:text-xs peer-focus:text-[var(--color-primary-green)]
                  peer-not-placeholder-shown:-top-3 peer-not-placeholder-shown:text-xs"
              >
                Your Email
              </label>
            </div>

            {/* Message */}
            <div className="relative group">
              <textarea
                id="contact-message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows={5}
                placeholder=" "
                className="peer w-full bg-transparent border-b-2 border-[var(--color-glass-border)]
                  focus:border-[var(--color-primary-green)] outline-none
                  py-3 text-[var(--color-text-primary)] transition-colors duration-300 resize-none
                  placeholder-transparent"
                data-cursor-hover
              />
              <label
                htmlFor="contact-message"
                className="absolute left-0 top-3 text-sm text-[var(--color-text-muted)]
                  transition-all duration-300 pointer-events-none
                  peer-focus:-top-3 peer-focus:text-xs peer-focus:text-[var(--color-primary-green)]
                  peer-not-placeholder-shown:-top-3 peer-not-placeholder-shown:text-xs"
              >
                Your Message
              </label>
            </div>

            {/* Submit */}
            <div className="flex flex-col items-center gap-4 pt-4">
              <MagneticButton>
                {status === 'sending' ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : status === 'success' ? (
                  '✓ Message Sent!'
                ) : (
                  'Send Message'
                )}
              </MagneticButton>

              {status === 'error' && (
                <p className="text-sm text-red-400 font-mono">
                  Something went wrong. Please try again.
                </p>
              )}

              {status === 'success' && (
                <p className="text-sm text-[var(--color-primary-green)] font-mono">
                  Thanks for reaching out! I'll get back to you soon.
                </p>
              )}
            </div>
          </form>
        </SectionReveal>
      </div>
    </section>
  );
}
