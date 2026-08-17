import { useState } from 'react';
import { ArrowLeft, Calendar, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuth } from './AuthContext';

export function ResetPasswordPage() {
  const { session, updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }

    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) {
        setError(error);
        return;
      }

      setComplete(true);
      await signOut();
    } finally {
      setLoading(false);
    }
  }

  function returnToSignIn() {
    window.location.assign('/');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/20">
            <Calendar className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white">Set a New Password</h1>
          <p className="text-slate-400 mt-2">Ready Ops</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {complete ? (
            <div className="text-center">
              <CheckCircle2 className="text-emerald-400 mx-auto mb-4" size={44} />
              <h2 className="text-xl font-semibold text-white">Password updated</h2>
              <p className="mt-2 text-sm text-slate-300">
                Your account is secure. Sign in again with your new password.
              </p>
              <button
                type="button"
                onClick={returnToSignIn}
                className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Return to Sign In
              </button>
            </div>
          ) : session ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                    placeholder="At least 8 characters"
                    className="w-full px-4 py-2.5 pr-10 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(current => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm New Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  placeholder="Enter it again"
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && (
                <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <><KeyRound size={18} /> Update Password</>
                )}
              </button>
            </form>
          ) : (
            <div className="text-center">
              <KeyRound className="text-amber-300 mx-auto mb-4" size={42} />
              <h2 className="text-xl font-semibold text-white">Reset link expired or invalid</h2>
              <p className="mt-2 text-sm text-slate-300">
                Return to sign in and request a new password reset link.
              </p>
              <button
                type="button"
                onClick={returnToSignIn}
                className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft size={18} /> Return to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
