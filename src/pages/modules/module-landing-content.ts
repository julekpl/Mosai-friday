import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  Megaphone,
  PenTool,
  Route,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CORE_MODULES,
  MODULE_IDS,
  PLAN_MODULES,
  PLANS,
  type ModuleId,
  type Plan,
} from "@/convex/lib/capabilities";

/**
 * Copy for the public per-module landing pages (`/modules/:moduleId`).
 *
 * Truth rule (AGENTS.md §1, §5.5): every claim here describes something the
 * module really does today. No counts, no testimonials, no invented results,
 * and anything that needs the customer's own account says so. Plan
 * availability is derived from the capability registry, never hand-written,
 * so a plan change cannot leave a landing page lying.
 */

export interface ModuleLandingPoint {
  title: string;
  body: string;
}

export interface ModuleLandingContent {
  id: ModuleId;
  name: string;
  icon: LucideIcon;
  /** One short customer task, the page eyebrow. */
  task: string;
  headline: string;
  lede: string;
  /** The problem this module answers, in the customer's words. */
  problems: readonly string[];
  features: readonly ModuleLandingPoint[];
  steps: readonly ModuleLandingPoint[];
  /** What this module gives to, and takes from, the others. */
  connections: readonly { module: ModuleId; body: string }[];
  /** The promise that keeps the customer in control. */
  guarantee: ModuleLandingPoint;
  /** Honest limits: what needs the customer's own account or setup. */
  setupNote?: string;
}

export const MODULE_LANDINGS: Record<ModuleId, ModuleLandingContent> = {
  understand: {
    id: "understand",
    name: "Understand",
    icon: Search,
    task: "Know who you're selling to",
    headline: "Stop guessing who your customer is.",
    lede: "Write down your audiences, their goals, their frustrations and the evidence behind them. Everything else you make in MOSAI starts from here, so your posts, pages and campaigns speak to real people instead of everyone.",
    problems: [
      "Your marketing sounds generic because it is written for nobody in particular.",
      "What you know about your customers lives in your head, not somewhere your tools can use.",
      "Every new post or page starts from a blank page.",
    ],
    features: [
      {
        title: "Personas with evidence",
        body: "Goals, frustrations and the proof behind them for each audience, kept in one place you can edit at any time.",
      },
      {
        title: "Start from your website",
        body: "Point MOSAI at your public website and it drafts a first read of your business for you to check and correct.",
      },
      {
        title: "Talk to your buyer",
        body: "Chat with a persona to test a message, or ask an AI analyst about it. Both answer from the persona you wrote.",
      },
      {
        title: "A map of how it fits",
        body: "See which audiences connect to which journeys and content, so gaps are visible rather than hidden.",
      },
    ],
    steps: [
      {
        title: "Describe your business",
        body: "What you sell, where, and to whom. Or start from your website address.",
      },
      {
        title: "Name your audiences",
        body: "Add a persona per type of buyer, with goals and frustrations you have actually seen.",
      },
      {
        title: "Use it everywhere",
        body: "Every other module reads this context, so you only write it once.",
      },
    ],
    connections: [
      { module: "journeys", body: "Each persona gets journeys that show the path they take." },
      { module: "create", body: "Content gaps and drafts are organised per persona." },
      { module: "build", body: "Website pages are planned with your audiences in view." },
    ],
    guarantee: {
      title: "Your knowledge stays yours",
      body: "AI suggestions arrive as drafts you accept or change. Your project can be exported as a readable pack at any time.",
    },
  },
  journeys: {
    id: "journeys",
    name: "Journeys",
    icon: Route,
    task: "Follow the path your customers take",
    headline: "See the steps before the sale.",
    lede: "Map how each audience finds you, decides and buys: what they do, think and feel at every stage, and where it hurts. Then fix the weakest step first instead of spreading effort everywhere.",
    problems: [
      "You know people drop off somewhere, but not where or why.",
      "Your content covers the moment of purchase and skips everything before it.",
      "Improvements are chosen by gut feeling instead of by the customer's path.",
    ],
    features: [
      {
        title: "Stages and lanes",
        body: "Each stage has lanes for actions, thoughts, feelings, pain points and opportunities, so nothing gets lumped together.",
      },
      {
        title: "An experience score per stage",
        body: "Rate each stage so the weakest point of the journey stands out at a glance.",
      },
      {
        title: "One journey per audience",
        body: "Journeys belong to a persona, so a first-time buyer and a regular never share one blurry map.",
      },
    ],
    steps: [
      {
        title: "Pick an audience",
        body: "Start a journey for one of the personas you wrote in Understand.",
      },
      {
        title: "Fill the stages",
        body: "Note what happens at each step, and score how it feels for the customer.",
      },
      {
        title: "Act on the gaps",
        body: "Low scores and open opportunities become content and page ideas.",
      },
    ],
    connections: [
      { module: "understand", body: "Journeys start from the personas you already described." },
      { module: "create", body: "Journey stages define where content is missing." },
      { module: "build", body: "Pages can be planned around the stage a visitor is in." },
    ],
    guarantee: {
      title: "A working document, not a poster",
      body: "Every cell is editable text you own. Nothing is scored for you without your say.",
    },
  },
  create: {
    id: "create",
    name: "Create",
    icon: PenTool,
    task: "Make something worth reading",
    headline: "Content that knows who it's for.",
    lede: "Find the gaps in your content for each audience and journey stage, research topics, then write posts, pages, emails and video scripts with AI in an editor where you hold the pen. Drafts are grounded in your business context, not in nothing.",
    problems: [
      "You never know what to write next.",
      "AI tools give you polished text that sounds like everyone else.",
      "Content gets made in bursts, without a plan behind it.",
    ],
    features: [
      {
        title: "Content gaps, mapped",
        body: "See which audience and journey stage has nothing written for it yet, and dismiss what does not apply.",
      },
      {
        title: "From topic to draft",
        body: "Turn a gap into researched topics, then into a first draft you can shape.",
      },
      {
        title: "Many formats",
        body: "Social posts, web pages, emails and video scripts from the same context.",
      },
      {
        title: "An editor you control",
        body: "Tone, audience and length are visible settings. You edit every word before you save.",
      },
    ],
    steps: [
      {
        title: "See what's missing",
        body: "Gaps come from your personas and journeys, so the plan writes itself.",
      },
      {
        title: "Draft with AI",
        body: "Ask for the piece. AI writes the first pass from your context.",
      },
      {
        title: "Edit and save",
        body: "Change what you like. Saving is not publishing.",
      },
    ],
    connections: [
      { module: "understand", body: "Every draft is written for a persona you defined." },
      { module: "promote", body: "Finished pieces become social posts and campaigns." },
      { module: "build", body: "Pieces can feed the pages of your website." },
    ],
    guarantee: {
      title: "Drafts stay drafts",
      body: "Nothing you write in Create goes anywhere until you choose to use it in another module.",
    },
  },
  build: {
    id: "build",
    name: "Build",
    icon: Blocks,
    task: "Make a place for your business",
    headline: "A website planned around your customers.",
    lede: "Plan and build your website page by page, with your positioning, personas and journeys in view the whole way. Edit blocks in a visual editor, keep revisions, and publish when you are ready. Plan your app in the same place.",
    problems: [
      "Website builders start with templates, not with your customers.",
      "Pages get written without anyone asking who they are for.",
      "It is hard to tell what is live and what is still a draft.",
    ],
    features: [
      {
        title: "A plan before the pixels",
        body: "Get a site blueprint and page plans grounded in your idea, personas and journeys.",
      },
      {
        title: "A block editor",
        body: "Build pages from ready blocks and edit the text in place.",
      },
      {
        title: "Revisions you can trust",
        body: "Changes are saved as revisions, so you can see what changed and when.",
      },
      {
        title: "One website, one app",
        body: "Each project holds one website and one app, planned from the same context.",
      },
    ],
    steps: [
      {
        title: "Plan the site",
        body: "Start from your business context and choose the pages you need.",
      },
      {
        title: "Build the pages",
        body: "Fill each page with blocks and your own words, helped by AI.",
      },
      {
        title: "Publish on purpose",
        body: "A page shows as published only after it has really been published.",
      },
    ],
    connections: [
      { module: "understand", body: "Page plans are written for your audiences." },
      { module: "create", body: "Content pieces can become page copy." },
      { module: "sell", body: "Your product catalog can appear on the site." },
    ],
    guarantee: {
      title: "Published means published",
      body: "Saving a page never makes it public. The live badge appears only when the site really went out.",
    },
  },
  customers: {
    id: "customers",
    name: "Customers",
    icon: Users,
    task: "Keep your people close",
    headline: "One list of your people, with consent built in.",
    lede: "Keep contacts, company details and marketing consent in a list you own. Import a spreadsheet, preview it before anything is saved, and record for each person whether they agreed to hear from you.",
    problems: [
      "Customer details are spread over spreadsheets, inboxes and your phone.",
      "You are not sure who agreed to hear from you.",
      "Imports create duplicates and mess.",
    ],
    features: [
      {
        title: "Contacts and companies",
        body: "Names, addresses and company details together in one project list.",
      },
      {
        title: "Consent per contact",
        body: "Marketing consent is stored for each person, separately from their contact details.",
      },
      {
        title: "Safe CSV import",
        body: "Preview the file first. Repeated addresses are spotted, and importing never subscribes anyone to marketing.",
      },
    ],
    steps: [
      {
        title: "Bring your list",
        body: "Add contacts by hand or import a CSV file.",
      },
      {
        title: "Record consent",
        body: "Mark who asked to hear from you, and keep it up to date.",
      },
      {
        title: "Keep it current",
        body: "Update details and consent as they change, so the list stays one you can trust.",
      },
    ],
    connections: [
      { module: "understand", body: "Your personas describe types of buyer; Customers holds the real people." },
      { module: "promote", body: "Campaigns and contacts live in the same project, next to each other." },
    ],
    guarantee: {
      title: "Consent is not a checkbox we tick for you",
      body: "Importing a list never opts anyone in. A person counts as subscribed only when their consent is recorded.",
    },
  },
  promote: {
    id: "promote",
    name: "Promote",
    icon: Megaphone,
    task: "Get your next message out",
    headline: "Campaigns you approve, results you can verify.",
    lede: "Turn your content into social posts and campaigns. AI drafts versions for each platform and suggests a time; you review, schedule or publish. Posts show as published only when the platform confirms it.",
    problems: [
      "Posting takes hours of rewriting the same message for each platform.",
      "Tools post things you never checked.",
      "You can't tell whether a post really went out.",
    ],
    features: [
      {
        title: "Drafts for each platform",
        body: "One source becomes reviewable drafts shaped for each network. Nothing is scheduled automatically.",
      },
      {
        title: "A queue you control",
        body: "AI suggests a time; you approve by pressing Schedule or Publish now.",
      },
      {
        title: "Campaigns in one place",
        body: "Group posts into campaigns and keep ads next to the organic work they support.",
      },
      {
        title: "Real receipts",
        body: "A post is marked published only when the platform returns a receipt.",
      },
    ],
    steps: [
      {
        title: "Connect your accounts",
        body: "Link your own social and ad accounts with your own login.",
      },
      {
        title: "Draft and review",
        body: "Start from a content piece and let AI prepare each version.",
      },
      {
        title: "Schedule or publish",
        body: "You press the button. The status updates when the platform confirms.",
      },
    ],
    connections: [
      { module: "create", body: "Content pieces are the source for posts." },
      { module: "build", body: "Posts can point people to the pages you built." },
      { module: "grow", body: "Once Google Ads is connected, its results show up in Grow." },
    ],
    guarantee: {
      title: "You set the budget and press the button",
      body: "No post goes out and no ad money is spent without your approval.",
    },
    setupNote:
      "Publishing and ads need your own connected accounts. Until you connect one, the module shows it as needing setup instead of pretending.",
  },
  sell: {
    id: "sell",
    name: "Sell",
    icon: ShoppingBag,
    task: "Bring your products together",
    headline: "One catalog, ready for every channel.",
    lede: "Keep product names, prices, variants, media and availability in one catalog. MOSAI checks each product for readiness before it goes anywhere, groups them into collections and prepares a product feed.",
    problems: [
      "Product details disagree between your website, your shop and your ads.",
      "Listings get rejected for missing fields you did not know about.",
      "Updating a price means changing it in five places.",
    ],
    features: [
      {
        title: "Products and variants",
        body: "Sizes, colours and prices kept together, with media attached to each product.",
      },
      {
        title: "Readiness checks",
        body: "Each product is checked for what a channel needs, by fixed rules rather than AI guesses.",
      },
      {
        title: "Collections",
        body: "Group products for your website, campaigns and feed.",
      },
      {
        title: "A product feed",
        body: "Download a Google Merchant style feed built from your catalog.",
      },
    ],
    steps: [
      {
        title: "Add your products",
        body: "Enter them by hand or sync them from your Shopify store.",
      },
      {
        title: "Fix what's missing",
        body: "Readiness tells you exactly which fields each product still needs.",
      },
      {
        title: "Use them everywhere",
        body: "The same catalog feeds your site, campaigns and feed.",
      },
    ],
    connections: [
      { module: "build", body: "Website pages show products and collections straight from the catalog, prices included." },
    ],
    guarantee: {
      title: "Ready means ready",
      body: "A product only shows as ready when every check passes. Nothing goes live on a guess.",
    },
    setupNote:
      "Shopify sync needs your store connected. The feed is a download today; direct submission to Merchant Center is not part of the module yet.",
  },
  grow: {
    id: "grow",
    name: "Grow",
    icon: TrendingUp,
    task: "See what's working",
    headline: "Numbers you can trace back to their source.",
    lede: "Collect insights with their source and their date kept attached. Connect Google Analytics, Search Console or Google Ads and see what changed, without blended scores or charts drawn from nothing.",
    problems: [
      "Dashboards show one magic score and you can't tell where it came from.",
      "Data from different tools gets mixed until nobody trusts it.",
      "You can't tell if a number is from today or from last month.",
    ],
    features: [
      {
        title: "Source and freshness on every insight",
        body: "Each insight says where it came from and when, so stale data is obvious.",
      },
      {
        title: "Google data, kept separate",
        body: "Analytics, Search Console and Ads stay in their own sections, compared with the previous period.",
      },
      {
        title: "Insights you act on",
        body: "Mark an insight done or remove it, so the list stays a to-do list, not a museum.",
      },
    ],
    steps: [
      {
        title: "Connect a source",
        body: "Link your own Google account with your own login.",
      },
      {
        title: "Read what changed",
        body: "See the figures next to where they came from and how fresh they are.",
      },
      {
        title: "Act, then check",
        body: "Turn an insight into work in another module, then watch the numbers.",
      },
    ],
    connections: [
      { module: "promote", body: "Google Ads results sit next to the campaigns you run." },
      { module: "create", body: "Search Console queries show what people look for, a start for new topics." },
    ],
    guarantee: {
      title: "No numbers from nowhere",
      body: "If a source is not connected, Grow says so. It never fills the gap with sample data.",
    },
    setupNote:
      "Google figures appear only after you connect your own Google account and a sync has run.",
  },
};

/** Registry order, so the landing pages list modules the way the app does. */
export const MODULE_LANDING_LIST: readonly ModuleLandingContent[] =
  MODULE_IDS.map((id) => MODULE_LANDINGS[id]);

export function moduleLanding(id: string | undefined): ModuleLandingContent | null {
  if (!id) return null;
  return (MODULE_IDS as readonly string[]).includes(id)
    ? MODULE_LANDINGS[id as ModuleId]
    : null;
}

const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

/**
 * Where a module is available, read from the capability registry. Returns the
 * lowest plan that includes it; core modules are always included. Prices are
 * deliberately absent (not final, STATUS.md).
 */
export function moduleAvailability(id: ModuleId): {
  core: boolean;
  lowestPlan: Plan;
  label: string;
} {
  const core = CORE_MODULES.includes(id);
  const lowestPlan =
    PLANS.find((plan) => PLAN_MODULES[plan].includes(id)) ?? "scale";
  const label = core
    ? "Included in every workspace, including the Free plan"
    : `Included from the ${PLAN_LABELS[lowestPlan]} plan`;
  return { core, lowestPlan, label };
}
