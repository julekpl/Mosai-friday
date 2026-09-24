/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ads_adapters from "../ads/adapters.js";
import type * as ads_control from "../ads/control.js";
import type * as ads_copilot from "../ads/copilot.js";
import type * as ads_credentialActions from "../ads/credentialActions.js";
import type * as ads_credentials from "../ads/credentials.js";
import type * as ads_oauth from "../ads/oauth.js";
import type * as ads_platforms from "../ads/platforms.js";
import type * as ads_sync from "../ads/sync.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as billing from "../billing.js";
import type * as billingWebhooks from "../billingWebhooks.js";
import type * as buildChat from "../buildChat.js";
import type * as buildInternals from "../buildInternals.js";
import type * as buildPages from "../buildPages.js";
import type * as buildPlan from "../buildPlan.js";
import type * as buildWorkspace from "../buildWorkspace.js";
import type * as builds from "../builds.js";
import type * as campaigns from "../campaigns.js";
import type * as cms from "../cms.js";
import type * as collections from "../collections.js";
import type * as commerceEvents from "../commerceEvents.js";
import type * as communications from "../communications.js";
import type * as connections from "../connections.js";
import type * as contacts from "../contacts.js";
import type * as content from "../content.js";
import type * as contentPlanning from "../contentPlanning.js";
import type * as crons from "../crons.js";
import type * as dal from "../dal.js";
import type * as entitlements from "../entitlements.js";
import type * as files from "../files.js";
import type * as guards from "../guards.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as journeys from "../journeys.js";
import type * as lib_billingCatalog from "../lib/billingCatalog.js";
import type * as lib_billingReconcile from "../lib/billingReconcile.js";
import type * as lib_capabilities from "../lib/capabilities.js";
import type * as lib_contextPack from "../lib/contextPack.js";
import type * as lib_dataLifecycle from "../lib/dataLifecycle.js";
import type * as lib_dataRegistry from "../lib/dataRegistry.js";
import type * as lib_deliveryGate from "../lib/deliveryGate.js";
import type * as lib_modelGateway from "../lib/modelGateway.js";
import type * as lib_oauthBaseUrl from "../lib/oauthBaseUrl.js";
import type * as lib_platformAdmin from "../lib/platformAdmin.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_safeFetch from "../lib/safeFetch.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as media from "../media.js";
import type * as modules_privacy_deletionJobs from "../modules/privacy/deletionJobs.js";
import type * as modules_privacy_exportJobs from "../modules/privacy/exportJobs.js";
import type * as modules_privacy_obligations from "../modules/privacy/obligations.js";
import type * as organizations from "../organizations.js";
import type * as personaChat from "../personaChat.js";
import type * as personas from "../personas.js";
import type * as posts from "../posts.js";
import type * as products from "../products.js";
import type * as projects from "../projects.js";
import type * as research from "../research.js";
import type * as scraping from "../scraping.js";
import type * as sell_feed from "../sell/feed.js";
import type * as sell_queries from "../sell/queries.js";
import type * as sell_readiness from "../sell/readiness.js";
import type * as sellAI from "../sellAI.js";
import type * as shopifySync from "../shopifySync.js";
import type * as social_adapters from "../social/adapters.js";
import type * as social_copilot from "../social/copilot.js";
import type * as social_copilotData from "../social/copilotData.js";
import type * as social_credentialActions from "../social/credentialActions.js";
import type * as social_credentials from "../social/credentials.js";
import type * as social_executor from "../social/executor.js";
import type * as social_oauth from "../social/oauth.js";
import type * as social_platforms from "../social/platforms.js";
import type * as storefront from "../storefront.js";
import type * as users from "../users.js";
import type * as variants from "../variants.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "ads/adapters": typeof ads_adapters;
  "ads/control": typeof ads_control;
  "ads/copilot": typeof ads_copilot;
  "ads/credentialActions": typeof ads_credentialActions;
  "ads/credentials": typeof ads_credentials;
  "ads/oauth": typeof ads_oauth;
  "ads/platforms": typeof ads_platforms;
  "ads/sync": typeof ads_sync;
  ai: typeof ai;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  billing: typeof billing;
  billingWebhooks: typeof billingWebhooks;
  buildChat: typeof buildChat;
  buildInternals: typeof buildInternals;
  buildPages: typeof buildPages;
  buildPlan: typeof buildPlan;
  buildWorkspace: typeof buildWorkspace;
  builds: typeof builds;
  campaigns: typeof campaigns;
  cms: typeof cms;
  collections: typeof collections;
  commerceEvents: typeof commerceEvents;
  communications: typeof communications;
  connections: typeof connections;
  contacts: typeof contacts;
  content: typeof content;
  contentPlanning: typeof contentPlanning;
  crons: typeof crons;
  dal: typeof dal;
  entitlements: typeof entitlements;
  files: typeof files;
  guards: typeof guards;
  http: typeof http;
  insights: typeof insights;
  journeys: typeof journeys;
  "lib/billingCatalog": typeof lib_billingCatalog;
  "lib/billingReconcile": typeof lib_billingReconcile;
  "lib/capabilities": typeof lib_capabilities;
  "lib/contextPack": typeof lib_contextPack;
  "lib/dataLifecycle": typeof lib_dataLifecycle;
  "lib/dataRegistry": typeof lib_dataRegistry;
  "lib/deliveryGate": typeof lib_deliveryGate;
  "lib/modelGateway": typeof lib_modelGateway;
  "lib/oauthBaseUrl": typeof lib_oauthBaseUrl;
  "lib/platformAdmin": typeof lib_platformAdmin;
  "lib/roles": typeof lib_roles;
  "lib/safeFetch": typeof lib_safeFetch;
  "lib/stripe": typeof lib_stripe;
  media: typeof media;
  "modules/privacy/deletionJobs": typeof modules_privacy_deletionJobs;
  "modules/privacy/exportJobs": typeof modules_privacy_exportJobs;
  "modules/privacy/obligations": typeof modules_privacy_obligations;
  organizations: typeof organizations;
  personaChat: typeof personaChat;
  personas: typeof personas;
  posts: typeof posts;
  products: typeof products;
  projects: typeof projects;
  research: typeof research;
  scraping: typeof scraping;
  "sell/feed": typeof sell_feed;
  "sell/queries": typeof sell_queries;
  "sell/readiness": typeof sell_readiness;
  sellAI: typeof sellAI;
  shopifySync: typeof shopifySync;
  "social/adapters": typeof social_adapters;
  "social/copilot": typeof social_copilot;
  "social/copilotData": typeof social_copilotData;
  "social/credentialActions": typeof social_credentialActions;
  "social/credentials": typeof social_credentials;
  "social/executor": typeof social_executor;
  "social/oauth": typeof social_oauth;
  "social/platforms": typeof social_platforms;
  storefront: typeof storefront;
  users: typeof users;
  variants: typeof variants;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
