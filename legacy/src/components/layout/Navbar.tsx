import { useState, useEffect, useRef } from 'react';
import type { NavLink } from '../../types';

const NAV_LINKS: NavLink[] = [
  { label: 'Home', href: '#home' },
  { label: 'About', href: '#about' },
  { label: 'Projects', href: '#projects' },
  { label: 'Blog', href: '#blog' },
  { label: 'Contact', href: '#contact' },
];

// Standalone tool page — a real route, not an in-page section anchor.
const VIDEO_HREF = '/video/';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 50);

      // Hide on scroll down, show on scroll up
      if (scrollY > lastScrollY.current && scrollY > 100) {
        setIsHidden(true);
      } else {
        setIsHidden(false);
      }
      lastScrollY.current = scrollY;

      // Update active section
      const sections = NAV_LINKS.map((link) =>
        document.querySelector(link.href)
      ).filter(Boolean);

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i] as HTMLElement;
        if (section && section.offsetTop - 200 <= scrollY) {
          setActiveSection(NAV_LINKS[i].href.slice(1));
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Animate mobile menu
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [isMobileMenuOpen]);

  const handleNavClick = (href: string) => {
    setIsMobileMenuOpen(false);
    const element = document.querySelector(href);
    if (element) {
      const offset = 80;
      const top = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <>
      <nav
        ref={navRef}
        id="main-nav"
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          isScrolled
            ? 'py-3 backdrop-blur-xl bg-[rgba(10,10,15,0.8)] border-b border-[rgba(255,255,255,0.05)]'
            : 'py-5 bg-transparent'
        } ${isHidden && !isMobileMenuOpen ? '-translate-y-full' : 'translate-y-0'}`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          {/* Logo */}
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              handleNavClick('#home');
            }}
            className="text-xl font-bold tracking-tight gradient-text"
            data-cursor-hover
          >
            HC
          </a>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 lg:gap-8">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(link.href);
                }}
                data-cursor-hover
                className={`relative text-sm font-medium tracking-wide transition-colors duration-300 ${
                  activeSection === link.href.slice(1)
                    ? 'text-[var(--color-primary-green)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {link.label}
                {activeSection === link.href.slice(1) && (
                  <span className="absolute -bottom-1 left-0 right-0 h-[2px] bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)] rounded-full" />
                )}
              </a>
            ))}

            {/* Video Editor — separate tool page */}
            <a
              href={VIDEO_HREF}
              data-cursor-hover
              className="relative flex items-center gap-1.5 text-sm font-medium tracking-wide text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-300"
            >
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)]"
              />
              Video Editor
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            id="mobile-menu-toggle"
            className="md:hidden relative w-8 h-8 flex flex-col justify-center items-center gap-1.5"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
            data-cursor-hover
          >
            <span
              className={`block w-6 h-[2px] bg-[var(--color-text-primary)] transition-all duration-300 ${
                isMobileMenuOpen ? 'rotate-45 translate-y-[5px]' : ''
              }`}
            />
            <span
              className={`block w-6 h-[2px] bg-[var(--color-text-primary)] transition-all duration-300 ${
                isMobileMenuOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`block w-6 h-[2px] bg-[var(--color-text-primary)] transition-all duration-300 ${
                isMobileMenuOpen ? '-rotate-45 -translate-y-[5px]' : ''
              }`}
            />
          </button>
        </div>
      </nav>

      {/* Mobile fullscreen menu */}
      <div
        id="mobile-menu"
        className={`fixed inset-0 z-40 bg-[var(--color-bg-primary)] md:hidden transition-all duration-500 ${
          isMobileMenuOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex flex-col items-center justify-center h-full gap-8">
          {NAV_LINKS.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                e.preventDefault();
                handleNavClick(link.href);
              }}
              className={`text-3xl font-semibold transition-all duration-500 ${
                isMobileMenuOpen
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-8'
              } ${
                activeSection === link.href.slice(1)
                  ? 'gradient-text'
                  : 'text-[var(--color-text-secondary)]'
              }`}
              style={{ transitionDelay: isMobileMenuOpen ? `${i * 100}ms` : '0ms' }}
            >
              {link.label}
            </a>
          ))}

          {/* Video Editor — separate tool page */}
          <a
            href={VIDEO_HREF}
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 text-3xl font-semibold text-[var(--color-text-secondary)] transition-all duration-500 ${
              isMobileMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={{ transitionDelay: isMobileMenuOpen ? `${NAV_LINKS.length * 100}ms` : '0ms' }}
          >
            <span
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-primary-blue)]"
            />
            Video Editor
          </a>
        </div>
      </div>
    </>
  );
}
