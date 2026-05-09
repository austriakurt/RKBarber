# RK Barbershop System — ERD & Context Diagram

> [!NOTE]
> All diagrams below are **derived directly from the source code** — specifically from [types.ts](file:///c:/Users/james.DESKTOP-GRBUCUA/OneDrive/Desktop/RKBarber/RKBarber-main/client/src/lib/types.ts), [routes.ts](file:///c:/Users/james.DESKTOP-GRBUCUA/OneDrive/Desktop/RKBarber/RKBarber-main/server/routes.ts), [firestore.ts](file:///c:/Users/james.DESKTOP-GRBUCUA/OneDrive/Desktop/RKBarber/RKBarber-main/client/src/lib/firestore.ts), [schema.ts](file:///c:/Users/james.DESKTOP-GRBUCUA/OneDrive/Desktop/RKBarber/RKBarber-main/shared/schema.ts), and the Zod validation schemas in the server routes. No hallucinated entities or fields.

---

## 1. Context Diagram (Level 0 DFD)

This shows the system boundary and all external actors that interact with RK Barbershop.

```mermaid
graph TB
    subgraph External Actors
        CUST["👤 Customer<br/>(Walk-in / Online)"]
        ADMIN["🔑 Admin<br/>(Shop Owner/Staff)"]
        SMTP["📧 SMTP Server<br/>(Nodemailer)"]
        CLOUD["☁️ Cloudinary<br/>(Image CDN)"]
        FB_AUTH["🔐 Firebase Auth"]
        CRON["⏰ Vercel Cron<br/>(Scheduled Jobs)"]
    end

    subgraph "RK Barbershop System"
        SYS["🏪 RK Barbershop<br/>Web Application<br/>(Vite + Express + Firestore)"]
    end

    CUST -- "Browse services, barbers,<br/>gallery, location" --> SYS
    CUST -- "Submit reservation/walk-in<br/>booking with payment proof" --> SYS
    CUST -- "Join walk-in queue" --> SYS
    CUST -- "Confirm/Decline/Complete<br/>booking via email link" --> SYS
    SYS -- "Show real-time queue<br/>& booking status" --> CUST

    ADMIN -- "Login via Firebase Auth" --> SYS
    ADMIN -- "Manage barbers, services,<br/>bookings, queue, gallery, settings" --> SYS
    SYS -- "Admin dashboard<br/>& daily reports" --> ADMIN

    SYS -- "Send booking status,<br/>confirmation, completion,<br/>reminder, & queue emails" --> SMTP
    SMTP -- "Delivery status" --> SYS

    SYS -- "Upload images<br/>(payment proof, barber photos,<br/>gallery)" --> CLOUD
    CLOUD -- "Secure image URL" --> SYS

    SYS <-- "Verify ID tokens,<br/>admin claims" --> FB_AUTH

    CRON -- "Trigger daily<br/>reservation reminders" --> SYS
    SYS -- "Send reminder emails<br/>for tomorrow's bookings" --> SMTP

    style SYS fill:#1e293b,stroke:#3b82f6,stroke-width:3px,color:#f8fafc
    style CUST fill:#059669,stroke:#047857,color:#fff
    style ADMIN fill:#7c3aed,stroke:#6d28d9,color:#fff
    style SMTP fill:#dc2626,stroke:#b91c1c,color:#fff
    style CLOUD fill:#0ea5e9,stroke:#0284c7,color:#fff
    style FB_AUTH fill:#f59e0b,stroke:#d97706,color:#fff
    style CRON fill:#64748b,stroke:#475569,color:#fff
```

---

## 2. Entity Relationship Diagram (ERD)

The system uses **two data stores**:
1. **Firebase Firestore** (NoSQL) — Primary data store for all business entities (6 collections)
2. **PostgreSQL via Drizzle** (optional/legacy) — Only `users` table defined in `shared/schema.ts`, used via in-memory storage

### 2.1 Complete ERD

```mermaid
erDiagram
    BARBERS {
        string id PK "Auto-generated Firestore doc ID"
        string name "Barber's display name"
        string specialty "Derived: comma-joined service names"
        string[] services "FK Array of Service IDs offered"
        number reservePrice "Reservation price (PHP)"
        number walkinPrice "Walk-in price (PHP)"
        boolean active "Whether barber is currently active"
        string image "Profile image URL (Cloudinary)"
        number order "Display sort order"
        string[] availableDays "e.g. Monday, Tuesday..."
        string availableFrom "e.g. 9:00 AM"
        string availableTo "e.g. 8:00 PM"
        string[] daysOff "Specific ISO dates off (yyyy-MM-dd)"
        string createdAt "ISO 8601 timestamp"
    }

    SERVICES {
        string id PK "Auto-generated Firestore doc ID"
        string name "Service name"
        enum serviceType "solo | package"
        string[] includedServiceIds "FK Array of Service IDs (for packages)"
        string description "Service description"
        number price "Base display price (PHP)"
        number walkinPrice "Walk-in specific price"
        number reservationPrice "Reservation specific price"
        boolean noPrice "If true, price not shown"
        number duration "Duration in minutes"
        boolean active "Whether service is active"
        number order "Display sort order"
        string createdAt "ISO 8601 timestamp"
    }

    BOOKINGS {
        string id PK "Auto-generated Firestore doc ID"
        string barberId FK "References BARBERS.id"
        string barberName "Denormalized barber name"
        string serviceId FK "References SERVICES.id (primary)"
        string serviceName "Denormalized service name"
        string[] serviceIds FK "All selected Service IDs"
        string[] serviceNames "All selected service names"
        string customerName "Customer full name"
        string phone "PH phone (09xx or +639xx)"
        string email "Customer email (required for reservations)"
        string notes "Optional booking notes"
        string paymentProofUrl "Cloudinary URL of GCash proof"
        string date "Booking date (yyyy-MM-dd)"
        string time "Booking time (e.g. 2:00 PM)"
        enum type "reservation | walkin"
        enum status "pending | confirmed | cancelled | completed"
        number price "Calculated price (PHP)"
        enum customerDecision "awaiting | accepted | cancelled | reschedule_requested | expired"
        boolean customerActionRequired "Whether customer action is pending"
        string customerActionDeadline "ISO deadline for customer action"
        string customerDecisionAt "ISO timestamp of decision"
        string customerTokenHash "HMAC-SHA256 hash for email action links"
        string completionRequestedAt "When completion was requested"
        string completionConfirmedAt "When completion was confirmed"
        enum completedBy "client | admin"
        string forceCompletedAt "When force-completed"
        boolean emailNotificationSent "Last email send success"
        string emailNotificationError "Last email error message"
        string reminderSentForDate "Date for which reminder was sent"
        string reminderLastSentAt "ISO timestamp of last reminder"
        string reminderLastError "Last reminder error"
        string rescheduledAt "When booking was rescheduled"
        string autoCancelledAt "When auto-cancelled (legacy)"
        string createdAt "ISO 8601 timestamp"
    }

    QUEUE {
        string id PK "Auto-generated Firestore doc ID"
        string barberId FK "References BARBERS.id"
        string customerName "Walk-in customer name"
        string phone "Customer phone"
        string email "Optional customer email"
        number position "Queue position (ascending)"
        enum status "waiting | in-progress | done"
        string queueNotifiedAt "ISO timestamp when email notification sent"
        string createdAt "ISO 8601 timestamp"
    }

    GALLERY {
        string id PK "Auto-generated Firestore doc ID"
        string imageUrl "Cloudinary image URL"
        string caption "Image caption"
        string barberId FK "Optional: references BARBERS.id"
        string hairstyleName "Optional: hairstyle label"
        number order "Display sort order"
        string createdAt "ISO 8601 timestamp"
    }

    SETTINGS {
        string doc_id PK "Always 'shop' (singleton)"
        string shopName "e.g. RK Barbershop"
        string address "Street address"
        string city "City"
        string province "Province"
        string country "Country"
        string openTime "e.g. 9:00 AM"
        string closeTime "e.g. 8:00 PM"
        string operatingDays "e.g. Monday - Sunday"
        string email "Shop contact email"
        string facebookUrl "Facebook page URL"
        string tiktokUrl "TikTok URL"
        string googleMapsUrl "Google Maps embed URL"
        string tagline "Shop tagline"
        string aboutText "About section text"
        string gcashNumber "GCash payment number"
        string gcashQrCodeUrl "GCash QR code image URL"
        string reservationPolicyText "Reservation policy text"
        string combo1ServiceAId FK "Combo 1 Service A ID"
        string combo1ServiceBId FK "Combo 1 Service B ID"
        number combo1WalkinPrice "Combo 1 walk-in price"
        number combo1ReservationPrice "Combo 1 reservation price"
        string combo2ServiceAId FK "Combo 2 Service A ID"
        string combo2ServiceBId FK "Combo 2 Service B ID"
        number combo2WalkinPrice "Combo 2 walk-in price"
        number combo2ReservationPrice "Combo 2 reservation price"
    }

    USERS {
        string id PK "UUID (PostgreSQL / in-memory)"
        string username UK "Unique username"
        string password "Hashed password"
    }

    BARBERS ||--o{ BOOKINGS : "serves"
    BARBERS ||--o{ QUEUE : "has queue for"
    BARBERS ||--o{ GALLERY : "featured in"
    SERVICES ||--o{ BOOKINGS : "booked as"
    BARBERS }o--o{ SERVICES : "offers (via services[] array)"
    SERVICES }o--o{ SERVICES : "includes (package → solo, via includedServiceIds[])"
    SETTINGS }o--o{ SERVICES : "references combos (combo1/2 ServiceA/B IDs)"
```

### 2.2 Relationship Summary Table

| Relationship | Type | Implementation | Source Field(s) |
|---|---|---|---|
| Barber → Bookings | One-to-Many | `bookings.barberId` references `barbers.id` | `BOOKINGS.barberId` |
| Barber → Queue | One-to-Many | `queue.barberId` references `barbers.id` | `QUEUE.barberId` |
| Barber → Gallery | One-to-Many (optional) | `gallery.barberId` references `barbers.id` | `GALLERY.barberId` |
| Barber ↔ Services | Many-to-Many | `barbers.services[]` stores array of service IDs | `BARBERS.services` |
| Service → Bookings | One-to-Many | `bookings.serviceId` & `bookings.serviceIds[]` | `BOOKINGS.serviceId`, `BOOKINGS.serviceIds` |
| Service → Service | Self-referencing (package) | `services.includedServiceIds[]` for packages | `SERVICES.includedServiceIds` |
| Settings → Services | Reference (combos) | `settings.combo1ServiceAId`, etc. | `SETTINGS.combo1ServiceAId/BId`, `combo2...` |
| Users (standalone) | No FK relationships | In-memory storage; not linked to Firestore entities | — |

> [!IMPORTANT]
> **Firestore is schemaless** — relationships are enforced at the application layer (Zod schemas + route handlers), not by the database. All foreign keys above are logical, not database-enforced constraints.

---

## 3. Firestore Collections Map

```mermaid
graph LR
    subgraph "Firebase Firestore Database"
        B["📦 barbers<br/>Collection"]
        S["📦 services<br/>Collection"]
        BK["📦 bookings<br/>Collection"]
        Q["📦 queue<br/>Collection"]
        G["📦 gallery<br/>Collection"]
        ST["📦 settings<br/>Singleton Doc: 'shop'"]
    end

    subgraph "Access Patterns"
        PUB["🌐 Public (Client SDK)"]
        ADM["🔒 Admin (Server API)"]
    end

    PUB -- "onSnapshot (real-time)" --> B
    PUB -- "onSnapshot (real-time)" --> S
    PUB -- "onSnapshot (real-time)" --> BK
    PUB -- "onSnapshot (real-time)" --> Q
    PUB -- "onSnapshot (real-time)" --> G
    PUB -- "getDoc" --> ST

    ADM -- "CRUD via /api/admin/*" --> B
    ADM -- "CRUD via /api/admin/*" --> S
    ADM -- "CRUD via /api/admin/*" --> BK
    ADM -- "CRUD via /api/admin/*" --> Q
    ADM -- "CRUD via /api/admin/*" --> G
    ADM -- "PATCH via /api/admin/settings" --> ST

    style PUB fill:#059669,stroke:#047857,color:#fff
    style ADM fill:#7c3aed,stroke:#6d28d9,color:#fff
```

---

## 4. System Architecture Overview

```mermaid
graph TB
    subgraph "Client Layer (Vite + React)"
        HOME["🏠 Home Page<br/>Services, Gallery, Booking"]
        BARB["💈 Barbers Page<br/>Barber profiles"]
        LOC["📍 Location Page<br/>Map & contact"]
        ADMN["⚙️ Admin Dashboard<br/>Full CRUD management"]
        BMOD["📋 Booking Modal<br/>Reservation/Walk-in form"]
        QBOARD["📊 Queue Board<br/>Real-time queue display"]
    end

    subgraph "Client Libraries"
        FBSDK["Firebase Client SDK<br/>(Auth + Firestore)"]
        AAPI["Admin API Client<br/>(adminApi.ts)"]
    end

    subgraph "Server Layer (Express)"
        RT["Express Routes<br/>(routes.ts)"]
        MW["requireAdmin<br/>Middleware"]
    end

    subgraph "Vercel Serverless"
        VADM["api/admin/[...path].ts<br/>Admin catch-all"]
        VBKNG["api/bookings/[...path].ts<br/>Booking catch-all"]
        VCRON["api/cron/[job].ts<br/>Scheduled jobs"]
        VUPL["api/uploads/[route].ts<br/>Image upload proxy"]
    end

    subgraph "External Services"
        FAUTH["🔐 Firebase Auth"]
        FDB["🗄️ Cloud Firestore"]
        CLDNY["☁️ Cloudinary"]
        SMTPS["📧 SMTP (Email)"]
    end

    HOME --> FBSDK
    BARB --> FBSDK
    ADMN --> AAPI
    BMOD --> RT
    QBOARD --> FBSDK

    FBSDK --> FAUTH
    FBSDK --> FDB
    AAPI --> VADM
    AAPI --> RT

    RT --> MW
    MW --> FAUTH
    RT --> FDB
    RT --> CLDNY
    RT --> SMTPS

    VADM --> FDB
    VADM --> SMTPS
    VBKNG --> FDB
    VBKNG --> SMTPS
    VCRON --> FDB
    VCRON --> SMTPS
    VUPL --> CLDNY

    style FDB fill:#f59e0b,stroke:#d97706,color:#000
    style FAUTH fill:#f59e0b,stroke:#d97706,color:#000
    style CLDNY fill:#0ea5e9,stroke:#0284c7,color:#fff
    style SMTPS fill:#dc2626,stroke:#b91c1c,color:#fff
```

---

## 5. Data Flow — Booking Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending : Customer submits reservation<br/>(with GCash payment proof)
    [*] --> Confirmed : Customer submits walk-in<br/>(auto-confirmed)

    Pending --> Confirmed : Admin approves<br/>(email: "Booking Approved")
    Pending --> Cancelled : Admin cancels<br/>(email: "Booking Cancelled")
    Pending --> Confirmed : Admin reschedules<br/>(email: "Booking Rescheduled")

    Confirmed --> Completed : Admin marks complete<br/>(email: "Service Completed")
    Confirmed --> Completed : Customer confirms via email link<br/>(completedBy: "client")
    Confirmed --> Cancelled : Admin cancels

    Completed --> [*]
    Cancelled --> [*]
```

---

## 6. API Endpoints Summary

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | None | Health check |
| `GET` | `/api/users/:id` | None | Get user by ID |
| `GET` | `/api/users?username=` | None | Get user by username |
| `POST` | `/api/users` | None | Create user |
| `POST` | `/api/uploads/image` | None | Upload image to Cloudinary |
| `GET` | `/api/uploads/download` | None | Proxy download from Cloudinary |
| `POST` | `/api/bookings` | None | Create booking (reservation/walk-in) |
| `GET` | `/api/bookings/action` | Token | Customer email action (confirm/decline/complete) |
| `GET` | `/api/cron/expire-bookings` | Cron | Legacy — disabled |
| `GET` | `/api/cron/send-reservation-reminders` | Cron | Send tomorrow's booking reminders |
| `GET` | `/api/admin/bookings` | Admin | List all bookings |
| `PATCH` | `/api/admin/bookings/:id` | Admin | Update booking status/schedule |
| `DELETE` | `/api/admin/bookings/:id` | Admin | Delete booking |
| `PATCH` | `/api/admin/queue/:id` | Admin | Update queue item |
| `DELETE` | `/api/admin/queue/:id` | Admin | Remove from queue |
| `POST` | `/api/admin/queue/call-next` | Admin | Email next customers in queue |
| `POST` | `/api/admin/services` | Admin | Create service |
| `PATCH` | `/api/admin/services/:id` | Admin | Update service |
| `DELETE` | `/api/admin/services/:id` | Admin | Delete service |
| `POST` | `/api/admin/barbers` | Admin | Create barber |
| `PATCH` | `/api/admin/barbers/:id` | Admin | Update barber |
| `DELETE` | `/api/admin/barbers/:id` | Admin | Delete barber |
| `PATCH` | `/api/admin/settings` | Admin | Update shop settings |
| `POST` | `/api/admin/gallery` | Admin | Add gallery item |
| `PATCH` | `/api/admin/gallery/:id` | Admin | Update gallery item |
| `DELETE` | `/api/admin/gallery/:id` | Admin | Delete gallery item |

---

## 7. Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend Framework | React + TypeScript (Vite) |
| Routing | Wouter |
| UI Components | shadcn/ui (Radix + Tailwind) |
| State | React hooks + Firebase `onSnapshot` (real-time) |
| Backend | Express.js (dev) / Vercel Serverless (prod) |
| Database | Cloud Firestore (6 collections) |
| Auth | Firebase Authentication (Email/Password) |
| Image Storage | Cloudinary (via server-side signed upload) |
| Email | Nodemailer via SMTP |
| Cron Jobs | Vercel Cron (daily reservation reminders) |
| Schema Validation | Zod (server-side) |
| Deployment | Vercel |

> [!TIP]
> The `USERS` table (PostgreSQL/Drizzle in `shared/schema.ts`) exists as a **legacy/scaffold artifact** from the initial project template. The system's actual user management is handled entirely through **Firebase Authentication**, not this table. The in-memory `MemStorage` class wrapping it is unused in production flows.
