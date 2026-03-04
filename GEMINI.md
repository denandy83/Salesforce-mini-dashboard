# Mini Dashboard - Salesforce DX Project

## Project Overview
This project is a Salesforce DX application centered around the **Mini Dashboard** Lightning Web Component (LWC). The dashboard provides a high-level overview of Case statuses (New, Open, Waiting, Hold, All) across different scopes:
- **All:** Total cases in the system.
- **My:** Cases assigned to the current user.
- **Account/ICAO:** Cases associated with a specific Account (visible when on Account, Contact, or Case record pages).

The project includes advanced features like threshold alerts, real-time polling, drill-down modals with filtering/sorting, and CSV export functionality.

### Key Technologies
- **Salesforce DX (SFDX):** Project structure and deployment model.
- **Lightning Web Components (LWC):** Main UI component (`miniDashboard`).
- **Apex:** Backend controller (`MiniDashboardController`) for efficient data aggregation and querying.
- **Jest:** Unit testing for LWC.
- **Prettier & ESLint:** Code formatting and linting.

## Architecture
- **`force-app/main/default/lwc/miniDashboard/`**: The core LWC component.
  - `miniDashboard.js`: Manages state, polling, filtering, and interactions.
  - `miniDashboard.html`: Responsive grid layout and drill-down modal.
  - `miniDashboard.css`: Custom styling for heatmaps and status bars.
- **`force-app/main/default/classes/`**:
  - `MiniDashboardController.cls`: Apex class using aggregate queries for dashboard counts and dynamic SOQL for drill-down lists.
  - `MiniDashboardControllerTest.cls`: Unit tests for the Apex controller.

## Building and Running

### Development Setup
1. Authenticate to your Dev Hub: `sf org login web -d`
2. Create a scratch org: `sf org create scratch -f config/project-scratch-def.json -a mini-dashboard-scratch`
3. Push source: `sf project deploy start`

### Key Commands
- **Apex Tests:** `sf apex run test -n MiniDashboardControllerTest -r human`
- **PROD Deployment:** `sf project deploy start -o PROD --test-level RunSpecifiedTests --tests MiniDashboardControllerTest`

## Development Conventions
- **Naming:** Follow standard Salesforce camelCase for JS/Apex variables and PascalCase for Apex classes.
- **Formatting:** Adhere to the `.prettierrc` configuration. Never just change code comments for the sake of it.
- **Testing:** New features should include corresponding Jest tests for LWC and Apex tests for any controller changes.
- **Safety:** Always use `with sharing` in Apex controllers and `AccessLevel.USER_MODE` in SOQL queries to respect FLS and Sharing Rules.
- **Environments:** UAT is the salesforce org used for testing, PROD is the org used for production. GIT is used for versioning.
  - **Mandatory Safety Rule:** Always deploy to UAT first.
  - **Explicit Confirmation:** NEVER deploy to PROD or stage/commit to GIT without a dedicated, standalone confirmation turn. Even if an initial request asks to "send to prod," I must complete the implementation and UAT deployment first, then stop and ask for explicit permission to proceed to PROD/GIT.
- **Testing:** Before changing any code when adding new features, test them with APEX scripts against UAT to verify logic
- **Debugging:** When asked to check for bugs, always check for bugs and list them. No code changes until explicitely asked to fix the bugs. 

