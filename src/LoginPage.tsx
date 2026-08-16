import { useState } from 'react';
import { useAuth } from './AuthContext';
import { ArrowLeft, Calendar, Eye, EyeOff, KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password';

export function LoginPage() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const isSignUp = mode === 'sign-up';
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
      } else if (isSignUp) {
        const { error } = await signUp(email.trim(), password, displayName.trim() || email.trim());
        if (error) setError(error);
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
          <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/20">
            <Calendar className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white">Ready Ops</h1>
          <p className="text-slate-400 mt-2">
            {isForgotPassword
              ? 'Recover access to your account'
              : isSignUp
                ? 'Create your agent account'
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
          ) : (
            <div className="flex bg-white/5 rounded-lg p-1 mb-6">
              <button
                type="button"
                onClick={() => changeMode('sign-in')}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  !isSignUp ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => changeMode('sign-up')}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  isSignUp ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {!isForgotPassword && <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
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
              {!isSignUp && (
                <button
                  type="button"
                  onClick={() => changeMode('forgot-password')}
                  className="mt-2 text-sm font-medium text-blue-300 hover:text-blue-200"
                >
                  Forgot password?
                </button>
              )}
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
              ) : isSignUp ? (
                <><UserPlus size={18} /> Create Account</>
              ) : (
                <><LogIn size={18} /> Sign In</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          {isForgotPassword
            ? <><KeyRound size={13} className="inline mr-1" />Reset links expire and can only be used once.</>
            : 'New accounts are created as agents. An admin assigns access and teams.'}
        </p>
      </div>
    </div>
  );
}
