# Changelog

## [Unreleased]

### Added

**Initial Setup**
- Created initial repository structure.
- Added README.md, PROJECT_CONTEXT.md, TODO.md, and CHANGELOG.md.
- Finalized database schemas and UI/UX design language.

**Backend Architecture & APIs**
- Initialized Express server, MongoDB connection, and Mongoose schemas (Users, Products, Squads, Transactions, Orders, Disputes).
- Implemented Auth middleware and WhatsApp OTP controllers.
- Built Hybrid Catalog (Products) controllers with strict TypeScript typing.
- Implemented Safepay digital escrow mocks and Squad Engine webhooks.
- Added BullMQ resolution workers (`votingResolutionWorker`) to finalize 2-hour voting windows and process Safepay captures/voids.
- Created `orderController` featuring `computeOrderFinance` to enforce the State Bank of Pakistan zero-wallet invariant.
- Implemented `disputeController` for buyer ticketing and QA.
- Added `courierWebhook` to sync logistics updates directly from dropshipping partners.
- Added `resolveDispute` for Admins to process Refunds (via Safepay mock) or Reject tickets, wrapped in a Mongoose transaction.
- Re-engineered the backend escrow webhook to use idempotent, sequential writes to bypass local standalone MongoDB replica set limitations.

**Frontend (Next.js)**
- Initialized Next.js frontend connected to the live Node.js backend.
- Built Hybrid Homepage, `/products` catalog, and dynamic `/products/[id]` pages fetching live data.
- Implemented real WhatsApp OTP login modal integrated with backend auth routes.
- Created database seed script for active Tolis (Squads) and products.
- Built Dual-Checkout Product Detail Page (PDP) featuring dynamic pricing and Safepay integration.
- Built protected Buyer Dashboard (`/dashboard`) with "Active Pledges" (Voting UI) and "Order History" (Logistics Timeline).
