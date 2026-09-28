import Link from 'next/link'
import type { ComponentProps } from 'react'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Navigation action styled with the same canonical variants as Button. */
export default function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...rest} />
}
