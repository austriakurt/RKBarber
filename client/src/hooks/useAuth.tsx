import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  getIdTokenResult,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const adminAllowlist = (import.meta.env.VITE_ADMIN_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((entry: string) => entry.trim().toLowerCase())
    .filter(Boolean);

  const adminEmailFallback = (import.meta.env.VITE_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

  const allowedAdminEmails = new Set([
    ...adminAllowlist,
    ...(adminEmailFallback ? [adminEmailFallback] : []),
  ]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      setUser(u);

      if (!u) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        const token = await getIdTokenResult(u);
        const claims = token.claims as Record<string, unknown>;
        const hasAdminClaim = claims.admin === true || claims.role === "admin";
        const email = (u.email || "").trim().toLowerCase();
        const hasAllowedEmail = email.length > 0 && allowedAdminEmails.has(email);

        setIsAdmin(hasAdminClaim || hasAllowedEmail);
      } catch {
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      throw new Error("No authenticated admin user");
    }

    const credential = EmailAuthProvider.credential(currentUser.email, oldPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signIn, signOut, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
