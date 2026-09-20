'use client'

// Root error boundary: catches render/data errors in any segment that has no
// closer boundary (login, onboarding, public tracking page...).
import ErrorView from './error-view'

export default ErrorView
