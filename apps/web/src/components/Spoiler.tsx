import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';

/**
 * Spoiler shield: the content is blurred and unreachable until the user explicitly asks for it.
 * While hidden it is also kept from screen readers and from text selection, so nothing leaks.
 */
export function Spoiler({
  children,
  label,
  action,
  inline = false,
}: {
  children: ReactNode;
  /** What is hidden, said without giving it away. */
  label?: string;
  /** Text of the button that reveals it. */
  action?: string;
  inline?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  if (shown) return <>{children}</>;

  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper
      className={inline ? 'inline-flex items-center gap-2' : 'grid justify-items-start gap-2'}
    >
      <Wrapper aria-hidden="true" className="pointer-events-none select-none blur-sm">
        {children}
      </Wrapper>
      <span className="sr-only">{label ?? t('hintLadder.hidden')}</span>
      <button type="button" className={inline ? 'btn-quiet' : 'btn'} onClick={() => setShown(true)}>
        {action ?? t('hintLadder.revealGeneric')}
      </button>
    </Wrapper>
  );
}
