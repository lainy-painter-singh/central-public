/**
 * Domains to skip when matching attendee emails to companies.
 * These are NOT startups/portfolio companies — they're infrastructure
 * around the deal (VCs, law firms, banks, expert networks, etc.)
 *
 * Your firm's domains are added dynamically via FIRM_DOMAINS in .env.
 */
import { getFirmDomains } from './user-settings'

const STATIC_SKIP_DOMAINS = new Set([
  // Common email providers
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
  'live.com', 'msn.com',

  // VC / PE / Growth equity funds
  'capitalg.com',             // CapitalG (Alphabet)
  'redpoint.com',             // Redpoint Ventures
  'insightpartners.com',      // Insight Partners
  'lightbank.com',            // Lightbank
  '1984.vc',                  // 1984 Ventures
  'valuestreamventures.com',  // Value Stream Ventures
  'engineeringcapital.com',   // Engineering Capital
  'operatorpartners.com',     // Operator Partners
  'a16z.com',                 // Andreessen Horowitz
  'sequoiacap.com',           // Sequoia Capital
  'kpcb.com',                 // Kleiner Perkins
  'greylock.com',             // Greylock Partners
  'accel.com',                // Accel
  'benchmark.com',            // Benchmark
  'indexventures.com',        // Index Ventures
  'felicis.com',              // Felicis Ventures
  'foundersco.com',           // Founders Co-op
  'foundersfund.com',         // Founders Fund
  'lux.capital',              // Lux Capital
  'luxcapital.com',
  'ivp.com',                  // IVP
  'gv.com',                   // GV (Google Ventures)
  'nea.com',                  // NEA
  'bvp.com',                  // Bessemer
  'bessemer.com',
  'usv.com',                  // Union Square Ventures
  'sparkcapital.com',         // Spark Capital
  'generalcatalyst.com',      // General Catalyst
  'ribbitcap.com',            // Ribbit Capital
  'iconiqcapital.com',        // Iconiq Capital
  'thrive.capital',           // Thrive Capital
  'tigerglobal.com',          // Tiger Global
  'coatue.com',               // Coatue
  'addition.com',             // Addition (Lee Fixel)
  'costanoa.vc',              // Costanoa Ventures
  'menlovc.com',              // Menlo Ventures
  'matrix.vc',                // Matrix Partners
  'mayfield.com',             // Mayfield
  'initialized.com',          // Initialized Capital
  'ycombinator.com',          // Y Combinator
  'svangel.com',              // SV Angel
  'firstround.com',           // First Round Capital
  'floodgate.com',            // Floodgate
  'upfront.com',              // Upfront Ventures
  'dcvc.com',                 // DCVC
  'boldstart.vc',             // Boldstart Ventures
  'clutch.vc',                // Clutch (VC fund)

  // PE firms / banks / financial institutions
  'blackstone.com',           // Blackstone
  'kkr.com',                  // KKR
  'apolloglobal.com',         // Apollo
  'carlyle.com',              // Carlyle
  'svb.com',                  // SVB
  'jpmorgan.com',             // JPMorgan
  'goldmansachs.com',         // Goldman Sachs
  'gs.com',
  'morganstanley.com',        // Morgan Stanley
  'bofa.com',                 // Bank of America
  'citi.com',                 // Citi
  'hercules.com',             // Hercules Capital
  'westerntech.com',          // Western Technology Investment

  // Law firms
  'morganlewis.com',          // Morgan Lewis
  'wsgr.com',                 // Wilson Sonsini
  'cooley.com',               // Cooley
  'gundersonlaw.com',         // Gunderson Dettmer
  'goodwinlaw.com',           // Goodwin
  'fenwick.com',              // Fenwick & West
  'orrick.com',               // Orrick
  'lw.com',                   // Latham & Watkins
  'dlapiper.com',             // DLA Piper
  'pillsburylaw.com',         // Pillsbury

  // Expert networks / research platforms
  'alphasights.com',          // AlphaSights
  'tegus.com',                // Tegus
  'alpha-sense.com',          // AlphaSense
  'glgroup.com',              // GLG
  'thirdbridge.com',          // Third Bridge
  'guidepoint.com',           // Guidepoint

  // Large AI companies (not deal prospects)
  'anthropic.com',            // Anthropic
  'openai.com',               // OpenAI

  // Large public companies (not startups)
  'twilio.com',               // Twilio
  'chevron.com',              // Chevron
  'skechers.com',             // Skechers
  'compass.com',              // Compass
  'paychex.com',              // Paychex
  'groupon.com',              // Groupon
  'servicetitan.com',         // ServiceTitan (public)
  'google.com',               // Google
  'microsoft.com',            // Microsoft
  'amazon.com',               // Amazon
  'apple.com',                // Apple
  'meta.com',                 // Meta
  'facebook.com',
  'salesforce.com',           // Salesforce
  'oracle.com',               // Oracle
  'sap.com',                  // SAP
  'adobe.com',                // Adobe
  'slack.com',                // Slack (Salesforce)
  'zoom.us',                  // Zoom
  'zoom.com',
  'atlassian.com',            // Atlassian
  'stripe.com',               // Stripe
  'palantir.com',             // Palantir
  'snowflake.com',            // Snowflake
  'datadog.com',              // Datadog
  'crowdstrike.com',          // CrowdStrike
  'fiverr.com',               // Fiverr

  // Calendar / resource emails
  'resource.calendar.google.com',
  'group.calendar.google.com',

  // Universities / hospitals (research contacts, not companies)
  'cumc.columbia.edu',
  'mayo.edu',

])

/**
 * Returns the full set of domains to skip, including your firm's domains
 * from FIRM_DOMAINS in .env. Use this instead of SKIP_DOMAINS directly.
 */
export function getSkipDomains(): Set<string> {
  const combined = new Set(STATIC_SKIP_DOMAINS)
  for (const d of getFirmDomains()) combined.add(d)
  return combined
}

/** @deprecated Use getSkipDomains() instead */
export const SKIP_DOMAINS = STATIC_SKIP_DOMAINS
