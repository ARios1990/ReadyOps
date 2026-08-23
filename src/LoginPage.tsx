import { useState } from 'react';
import { useAuth } from './AuthContext';
import { ArrowLeft, Eye, EyeOff, KeyRound, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { READYOPS_LOGO_DATA_URI } from './brand';

type AuthMode = 'sign-in' | 'forgot-password';

export function LoginPage() {
  const { signIn, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isForgotPassword = mode === 'forgot-password';

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError('');
    setMessage('');
    setPassword('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isForgotPassword) {
        const { error } = await requestPasswordReset(email.trim());
        if (error) {
          setError('We could not send a reset email. Please wait a moment and try again.');
        } else {
          setMessage('If an account exists for that email, a secure password reset link is on the way.');
        }
      } else {
        const { error } = await signIn(email.trim(), password);
        if (error) setError(error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 flex justify-center"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps" className="h-auto w-[260px] max-w-full" /></div>
          <h1 className="sr-only">Ready Ops</h1>
          <p className="text-slate-400 mt-2">
            {isForgotPassword
              ? 'Recover access to your account'
              : 'Sign in to manage your schedule'}
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {isForgotPassword ? (
            <button
              type="button"
              onClick={() => changeMode('sign-in')}
              className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white"
            >
              <ArrowLeft size={16} /> Back to sign in
            </button>
          ) : <div className="mb-6 flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm font-medium text-slate-200"><ShieldCheck size={16} /> Staff access only</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
                className="readyops-auth-input w-full px-4 py-2.5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {!isForgotPassword && <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                  className="readyops-auth-input w-full px-4 py-2.5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button type="button" onClick={() => changeMode('forgot-password')} className="mt-2 text-sm font-medium text-blue-300 hover:text-blue-200">Forgot password?</button>
            </div>}

            {error && (
              <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}

            {message && (
              <div role="status" className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-sm">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isForgotPassword ? (
                <><Mail size={18} /> Send Reset Link</>
              ) : (
                <><LogIn size={18} /> Sign In</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          {isForgotPassword
            ? <><KeyRound size={13} className="inline mr-1" />Reset links expire and can only be used once.</>
            : 'Accounts are created and linked by a ReadyOps administrator.'}
        </p>
      </div>
    </div>
  );
}
