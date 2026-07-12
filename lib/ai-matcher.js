import { readFile, writeFile } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Default cache configuration for AI matcher.
 * @type {Object}
 * @property {number} maxSize - Maximum number of entries in the cache
 * @property {number} ttlMs - Time to live in milliseconds
 * @property {string} persistPath - Path to the persistent cache file
 */
const CACHE_DEFAULTS = {
  maxSize: 100,
  ttlMs: 3600000, // 1 hour
  persistPath: "/tmp/omo-ai-matcher-cache.json",
};

/**
 * LRU cache implementation with TTL and persistence.
 * @class
 */
class AiMatcherCache {
  /**
   * Create an AI matcher cache.
   * @param {Object} options - Cache configuration options
   * @param {number} [options.maxSize=100] - Maximum number of entries
   * @param {number} [options.ttlMs=3600000] - Time to live in milliseconds
   * @param {string} [options.persistPath="/tmp/omo-ai-matcher-cache.json"] - Path to persist cache
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || CACHE_DEFAULTS.maxSize;
    this.ttlMs = options.ttlMs || CACHE_DEFAULTS.ttlMs;
    this.persistPath = options.persistPath || CACHE_DEFAULTS.persistPath;
    this.cache = new Map();
    this.loadFromDisk();
  }

  /**
   * Load cache from disk if file exists.
   * @private
   */
  loadFromDisk() {
    try {
      const content = readFile(this.persistPath, "utf8");
      const data = JSON.parse(content);
      if (data && Array.isArray(data.entries)) {
        // Filter out expired entries
        const now = Date.now();
        for (const [key, value] of Object.entries(data.entries)) {
          if (now - value.timestamp < this.ttlMs) {
            this.cache.set(key, value);
          }
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, start with empty cache
    }
  }

  /**
   * Save cache to disk.
   * @private
   */
  saveToDisk() {
    try {
      const data = {
        entries: Object.fromEntries(this.cache.entries()),
      };
      writeFile(this.persistPath, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      // Silently fail on disk write errors
    }
  }

  /**
   * Get a value from the cache.
   * @param {string} key - Cache key
   * @returns {Object|null} Cached value or null if not found or expired
   */
  get(key) {
    const value = this.cache.get(key);
    if (!value) return null;
    
    // Check if expired
    if (Date.now() - value.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.saveToDisk();
      return null;
    }
    
    return value;
  }

  /**
   * Set a value in the cache.
   * @param {string} key - Cache key
   * @param {Object} value - Value to cache
   */
  set(key, value) {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      ...value,
      timestamp: Date.now(),
    });
    
    this.saveToDisk();
  }

  /**
   * Clear all entries from the cache.
   */
  clear() {
    this.cache.clear();
    this.saveToDisk();
  }

  /**
   * Get all cache entries (for debugging).
   * @returns {Array} Array of cache entries
   */
  getAllEntries() {
    return Array.from(this.cache.entries());
  }
}

/**
 * Generate a cache key from requirement and provider.
 * @param {Object} requirement - Model requirement object
 * @param {string} provider - Provider name
 * @returns {string} Cache key
 */
function generateCacheKey(requirement, provider) {
  const hash = createHash("md5");
  hash.update(`${requirement.model || ""}${requirement.variant || ""}${provider}`);
  return hash.digest("hex");
}

/**
 * Create an AI matcher with the given fallback chain and probe state.
 * @param {Array} fallbackChain - Array of fallback chain entries from model-requirements.js
 * @param {Object} probeState - Probe state from lib/probe-providers.js
 * @returns {Object} AI matcher object with findClosestMatch and clearCache methods
 */
export function createAiMatcher(fallbackChain, probeState) {
  const cache = new AiMatcherCache();
  
  /**
   * Find the closest match using AI for the given requirement and provider model list.
   * @param {Object} requirement - Model requirement object
   * @param {Array} providerModelList - Array of {modelId, metadata} objects
   * @param {Object} [options] - Options for AI matching
   * @returns {Promise<Object|null>} AI match result or null if no match found
   */
  async function findClosestMatch(requirement, providerModelList, _options = {}) {
    if (!requirement || !providerModelList) return null;
    
    // Generate cache key
    const cacheKey = generateCacheKey(requirement, requirement.provider || "unknown");
    
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    
    // Iterate through fallback chain in order
    for (const chainEntry of fallbackChain) {
      // Skip if no providers
      if (!chainEntry.providers || chainEntry.providers.length === 0) continue;
      
      // Check each provider in order
      for (const provider of chainEntry.providers) {
        // Skip if provider is not available
        if (!isProviderAvailable(probeState, provider)) continue;
        
        // Skip if this is codex and we have other providers to try
        if (provider === "opencode" && hasOtherProvidersToTry(fallbackChain, chainEntry)) {
          continue;
        }
        
        // Try to get a match from this provider
        const match = await tryAiMatchWithProvider(
          requirement,
          providerModelList,
          provider,
          chainEntry.model,
          chainEntry.variant
        );
        
        if (match) {
          // Cache the successful match
          cache.set(cacheKey, match);
          return match;
        }
      }
    }
    
    return null;
  }

  /**
   * Check if a provider is available based on probe state.
   * @param {Object} probeState - Probe state from lib/probe-providers.js
   * @param {string} provider - Provider name
   * @returns {boolean} True if provider is available
   */
  function isProviderAvailable(probeState, provider) {
    // Check if provider is rate-limited or quota-restricted
    if (probeState.providerAvailability) {
      const state = probeState.providerAvailability.get(provider);
      if (state) {
        const now = Date.now();
        if (state.rateLimitedUntil && state.rateLimitedUntil > now) {
          return false;
        }
        if (state.creditExhausted) {
          return false;
        }
      }
    }
    
    // Additional provider availability checks can be added here
    return true;
  }

  /**
   * Check if there are other providers to try before codex.
   * @param {Array} fallbackChain - Full fallback chain
   * @param {Object} currentChainEntry - Current chain entry being processed
   * @returns {boolean} True if there are other providers to try
   */
  function hasOtherProvidersToTry(fallbackChain, currentChainEntry) {
    // Check if there are any non-codex providers in the chain
    for (const chainEntry of fallbackChain) {
      if (chainEntry === currentChainEntry) continue;
      if (chainEntry.providers && chainEntry.providers.length > 0) {
        for (const provider of chainEntry.providers) {
          if (provider !== "opencode") {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Try to get a match from a specific provider using AI.
   * @param {Object} requirement - Model requirement object
   * @param {Array} providerModelList - Array of {modelId, metadata} objects
   * @param {string} provider - Provider name
   * @param {string} model - Model name from fallback chain
   * @param {string} variant - Model variant from fallback chain
   * @returns {Promise<Object|null>} AI match result or null
   */
  async function tryAiMatchWithProvider(requirement, providerModelList, provider, model, _variant) {
    try {
      // Build prompt for AI matching
      const prompt = buildAiPrompt(requirement, providerModelList, provider);
      
      // Call the LLM for this provider
      const result = await callLlm(provider, `${provider}/${model}`, prompt);
      
      if (result && result.model && result.confidence !== undefined) {
        return {
          provider,
          model: result.model,
          confidence: result.confidence,
          reason: result.reason || `AI match via ${provider}/${model}`, 
          matchType: "ai",
        };
      }
    } catch (error) {
      // Silently fail and try next provider
    }
    
    return null;
  }

  /**
   * Build the AI prompt for matching.
   * @param {Object} requirement - Model requirement object
   * @param {Array} providerModelList - Array of {modelId, metadata} objects
   * @param {string} provider - Provider name
   * @param {string} model - Model name from fallback chain
   * @param {string} variant - Model variant from fallback chain
   * @returns {string} AI prompt
   */
  function buildAiPrompt(requirement, providerModelList, provider) {
    const requirementModel = requirement.model || "";
    const requirementVariant = requirement.variant || "";
    
    // Format available models
    const availableModels = providerModelList
      .map(({ modelId, metadata }) => {
        const contextWindow = metadata.context_length || 0;
        const modalities = metadata.modalities || [];
        const pricing = metadata.pricing || {};
        return {
          modelId,
          provider: metadata.provider || "unknown",
          contextWindow,
          modalities,
          pricing,
        };
      })
      .filter((m) => m.modelId);
    
    return `Given this requirement model NAME and VARIANT, and this list of available models from ${provider}, find the closest capability match by name, capability tier, and context window. Return JSON: {"model": "best match id", "confidence": 0-1, "reason": "..."}

Requirement:
- model: ${requirementModel}
- variant: ${requirementVariant}

Available models from ${provider}:
${JSON.stringify(availableModels, null, 2)}

Return only valid JSON with no additional text or markdown formatting.`;
  }

  /**
   * Call an LLM for matching. This is a placeholder that should be replaced with actual HTTP calls.
   * @param {string} provider - Provider name
   * @param {string} modelRef - Model reference (provider/model)
   * @param {string} prompt - Prompt for the LLM
   * @returns {Promise<Object>} LLM response
   */
  async function callLlm(_provider, _modelRef, _prompt) {
    // This is a placeholder implementation. In a real implementation, this would
    // make actual HTTP calls to the provider's API using the modelRef.
    // The actual implementation should be provided by the consuming code.
    
    // For now, return a mock response to satisfy the interface
    return {
      model: "mock-model",
      confidence: 0.5,
      reason: "Mock response - replace with actual LLM call",
    };
  }
  return {
    findClosestMatch,
    clearCache: () => cache.clear(),
  };
}