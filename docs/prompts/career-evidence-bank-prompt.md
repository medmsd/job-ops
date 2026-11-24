# ChatGPT prompt — Career Evidence Bank

Use this to fill **JobOps → Settings → Career Evidence → Evidence Bank**.

The prompt below already includes your Resume Studio project IDs and the profile facts extracted from your live JobOps database, so you do not need to paste anything else into ChatGPT.

**Extracted from:** Resume Studio document `primary_tenant_default`, revision 11, updated `2026-11-24T09:58:14.100Z`.

## How to use

1. Copy everything between the `~~~text` fences into ChatGPT.
2. Review the answer carefully, especially **NEVER CLAIM** — anything listed there will block PDF generation if it appears in tailored content.
3. Paste each returned section into the matching field in the Evidence Bank UI.
4. Save settings.

## Prompt

~~~text
You are helping me complete JobOps → Settings → Career Evidence → Evidence Bank.

STRICT RULES:
- Use ONLY the facts in MY DATA below.
- Do NOT invent skills, years, metrics, tools, seniority, certifications, or achievements.
- Do NOT use experience IDs as evidence refs. Use only:
  - project:<id> from the RESUME STUDIO PROJECTS list below, or
  - bank:<achievement-id> for an achievement you create in the ACHIEVEMENTS section.
- If something is not supported, write EMPTY and tell me what is missing.
- For TARGET ROLES and CLAIM RULES, you may propose options based on the data, but mark anything that is not directly supported as [REVIEW].
- Return plain text only. No commentary before or after.

Return EXACTLY these sections, in this order, so I can copy each one into the matching JobOps field:

1. TARGET ROLES
(one role per line)

2. CORE SKILLS
For each skill, output:
Name:
Years:
Level:
Aliases: (comma separated)
Evidence refs: (comma separated)

3. ACHIEVEMENTS
For each achievement, output:
ID: (short stable slug, e.g. oauth-rbac-platform)
Metric: (exact number from MY DATA, or EMPTY)
Fact: (one short sentence, fact only)
Evidence refs: (comma separated; use project:<id> or bank:<your-achievement-id>)

4. ALWAYS INCLUDE
(one per line)

5. NEVER CLAIM
(one per line; false claims I must not make)

6. PREFERRED TERMS
(one per line)

7. AVOID TERMS
(one per line)

FIELD MEANING:
- ALWAYS INCLUDE: verified terms the AI should keep.
- NEVER CLAIM: things that would be false for me. If any of these appear in tailored content, PDF generation is blocked. Be conservative and only list things that are genuinely unsupported by MY DATA.
- PREFERRED TERMS: wording I want the AI to prefer.
- AVOID TERMS: wording or style I do not want.
- Evidence refs are IDs, not descriptions.
- Bank achievement IDs you create may be referenced as bank:<that-id>. This is valid even if the achievement itself is the only source.
- Keep every entry short and factual. No marketing prose.

====================
KNOWN EVIDENCE REFS
====================
project:zxdhqfc2lkay94gxw6tbwnxm
project:qqri429gdotc3fw4yjb3ynek
project:foko1izco86ehy8y01eestz1
project:vhcs1q6wy3khjdqfooipoxvf
(plus any bank:<achievement-id> you create below)

====================
MY DATA
====================

Name: MOHAMED MSEDDI
Headline: Senior Java Backend Engineer
Location: Tunisia
Website: https://medmsd.github.io

Summary:
Senior Java Backend Engineer with 5+ years of experience designing and developing scalable microservices and secure REST APIs using Java and Spring Boot. Experienced in OAuth2 authentication and authorization, database optimization, and cloud-native deployments. Delivered infrastructure migrations, CI/CD automation, and performance improvements, with a strong focus on maintainable architecture, reliability, and software quality.

Note: The Resume Studio skills section is empty. Derive skill suggestions only from the project and experience text below.

RESUME STUDIO PROJECTS
(All four are marked hidden in the base resume, but their IDs are valid catalog IDs.)

- ID: zxdhqfc2lkay94gxw6tbwnxm
  Name: Timesheet Management PaaS – DSO Services
  Period: Feb 2021 – Jul 2021
  Details:
    - Built a multi-role time sheet platform using Spring Boot and Angular, implementing credit-management and e-signature workflows.
    - Integrated Google Calendar and Stripe to automate schedule aggregation and support scheduling and billing workflows.

- ID: qqri429gdotc3fw4yjb3ynek
  Name: COVID-19 Charity App
  Period: April 2020
  Details:
    - Dual-role app (donor and delivery) to facilitate donations for students in need.
    - Included geolocation, item filtering, donation tracking, and Firebase integration for real-time updates.

- ID: foko1izco86ehy8y01eestz1
  Name: Kubernetes YAML Generator Web Tool – SIFAST
  Period: Jul 2019 – Aug 2019
  Details:
    - Developed a web tool to generate Kubernetes configuration files, helping reduce manual deployment-configuration errors.

- ID: vhcs1q6wy3khjdqfooipoxvf
  Name: Bardo Museum Virtual Tour Game – Turku University
  Period: Feb 2018 – Jul 2018
  Details:
    - Developed an interactive virtual museum experience using Unity and C#, including voice-activated search with IBM Speech-to-Text.

EXPERIENCE
(Use these as source facts only. Do not use their IDs as evidence refs.)

Backend Engineer — Byrsa-Tech, France (Remote)
Sep 2021 – Present

- Led the migration of 8+ microservices from Clever Cloud to Scaleway Kubernetes, driving containerization and infrastructure decisions.
- Automated CI/CD pipelines with Jenkins, reducing deployment time by 70%.
- Optimized Kubernetes resource allocation and autoscaling to improve system stability during peak load.
- Developed unit and integration tests using TDD, JUnit, Mockito, and Testcontainers.
- Architected a centralized OAuth2 and RBAC platform serving 10,000+ users, securing 5+ production applications, and processing 50,000+ authentication requests per day.
- Reduced API response times by 35% through database query optimization and caching.
- Integrated Stripe payments and RabbitMQ-based asynchronous communication between the authorization server and connected applications.
- Developed a server-rendered web platform and scalable filtering for thousands of listings, reducing page-load time by 50%.

Client project: OBCO — Pharmaceutical Distribution Control Center
- Developed a French-first, server-side-rendered web application for a pharmaceutical distributor operating across 13 African countries, centralizing product catalogs, agencies, wholesalers, pricing, and monthly sales, stock, and order performance.
- Implemented role-based dashboards and standardized "Sorties Locales" reporting (R1–R8), with country/month filters, charts, sortable tables, Excel imports, and CSV/PDF exports.
- Contributed to a secure Supabase/PostgreSQL backend using row-level security, country/agency scoping, audit logging, and approximately 18 SQL RPC functions for server-side aggregation.
- OBCO technologies: React 19, TypeScript, TanStack Start, TanStack Query, Supabase, PostgreSQL, SQL, RLS, RPC, Tailwind CSS, shadcn/ui, Recharts, Vite.

END OF MY DATA
~~~

## Known refs quick copy

If the UI shows a **Known refs** line, it should match this:

```text
project:zxdhqfc2lkay94gxw6tbwnxm, project:qqri429gdotc3fw4yjb3ynek, project:foko1izco86ehy8y01eestz1, project:vhcs1q6wy3khjdqfooipoxvf
```

Bank achievement refs are added after you create achievements in the Evidence Bank, for example:

```text
bank:oauth-rbac-platform, bank:ci-cd-70-percent, bank:api-latency-35-percent
```
