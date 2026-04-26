import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type ServiceAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readServiceAccountFromEnv(): ServiceAccountConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

function ensureFirebaseAdminApp() {
  const existing = getApps()[0];
  if (existing) {
    return existing;
  }

  const serviceAccount = readServiceAccountFromEnv();
  if (serviceAccount) {
    return initializeApp({ credential: cert(serviceAccount) });
  }

  return initializeApp({ credential: applicationDefault() });
}

export function getFirebaseAdminServices() {
  const app = ensureFirebaseAdminApp();
  return {
    adminAuth: getAuth(app),
    adminDb: getFirestore(app),
  };
}
