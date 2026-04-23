// api/mcp.js - MCP Server Endpoint (Streamable HTTP Transport)
// Exponiert designare.at Knowledge Base für externe LLMs
// Protokoll: MCP Spec 2025-03-26 (JSON-RPC 2.0 über HTTP)
//
// ═══════════════════════════════════════════════════════════════
// CHANGELOG v1.2.0 (HEAD-Support & HTTP-Hygiene)
// ═══════════════════════════════════════════════════════════════
//   ✓ HEAD /api/mcp: Liveness-Probe ohne Body (200 statt 405)
//   ✓ 405-Responses liefern korrekten Allow-Header
//   ✓ CORS Allow-Methods um HEAD erweitert
//
// CHANGELOG v1.1.0 (Spec-Compliance Hardening)
// ═══════════════════════════════════════════════════════════════
//   ✓ initialize: Version-Negotiation mit Client-protocolVersion
//   ✓ notifications/*: Korrekte Behandlung als Notification (keine Response, HTTP 202)
//   ✓ Batch-Request Support (JSON-RPC 2.0 Array-Form)
//   ✓ INVALID_PARAMS (-32602) statt INVALID_REQUEST bei fehlendem Tool-Namen
//   ✓ CORS vereinheitlicht auf "*" (cache-freundlicher als Origin-Reflection)
//   ✓ Defensive Notification-Erkennung: id=undefined|null → keine Antwort
//
// Endpoint: POST   /api/mcp (Streamable HTTP – JSON-RPC Messages)
//           GET    /api/mcp (Health Check / Server-Info)
//           HEAD   /api/mcp (Liveness-Probe, kein Body)
//           DELETE /api/mcp (Session Cleanup – stateless no-op)
//
// Tools:
//   - search_knowledge: Semantische Suche in der designare.at Knowledge Base
//   - get_services:     Überblick über Michaels Leistungen & Expertise

import { checkRateLimit } from '../lib/rate-limiter.js';
import { MCP_SERVER_INFO, MCP_TOOLS, executeToolCall } from '../lib/mcp-config.js';

// ═══════════════════════════════════════════════════════════════
// Konstanten
// ═══════════════════════════════════════════════════════════════
const ALLOWED_METHODS = 'GET, HEAD, POST, DELETE, OPTIONS';

// ═══════════════════════════════════════════════════════════════
// CORS Headers
// ═══════════════════════════════════════════════════════════════
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 Helpers
// ═══════════════════════════════════════════════════════════════
function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// Standard JSON-RPC Error Codes
const PARSE_ERROR       = -32700;
const INVALID_REQUEST   = -32600;
const METHOD_NOT_FOUND  = -32601;
const INVALID_PARAMS    = -32602;
const INTERNAL_ERROR    = -32603;
// -32000..-32099 sind Server-definierte Errors
const RATE_LIMIT_ERROR  = -32000;

// Vom Server unterstützte MCP-Protokollversionen (neueste zuerst)
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

/**
 * JSON-RPC Notifications haben keine `id` (oder id=null).
 * Notifications dürfen NIE beantwortet werden.
 */
function isNotification(msg) {
  return !msg || msg.id === undefined || msg.id === null;
}

// ═══════════════════════════════════════════════════════════════
// Single Message Dispatch
// Gibt ein JSON-RPC Response-Objekt zurück — ODER null für Notifications.
// ═══════════════════════════════════════════════════════════════
async function handleRpcMessage(msg, clientIp) {
  // Defensive: Message muss ein Objekt sein
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return jsonRpcError(null, INVALID_REQUEST, 'Invalid Request: message must be an object');
  }

  const { method, params, id } = msg;
  const notification = isNotification(msg);

  // Method muss String sein
  if (!method || typeof method !== 'string') {
    return notification
      ? null
      : jsonRpcError(id, INVALID_REQUEST, 'Invalid Request: missing or invalid method');
  }

  console.log(`🔌 MCP [${method}]${notification ? ' (notification)' : ''} von ${clientIp}`);

  try {
    switch (method) {

      // ── initialize: Handshake mit Version-Negotiation ──
      case 'initialize': {
        const clientVersion = params?.protocolVersion;
        const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)
          ? clientVersion
          : MCP_SERVER_INFO.protocolVersion;

        return jsonRpcResponse(id, {
          protocolVersion: negotiatedVersion,
          capabilities: MCP_SERVER_INFO.capabilities,
          serverInfo: MCP_SERVER_INFO.serverInfo
        });
      }

      // ── tools/list ──
      case 'tools/list':
        return jsonRpcResponse(id, { tools: MCP_TOOLS });

      // ── tools/call ──
      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (!toolName || typeof toolName !== 'string') {
          return jsonRpcError(id, INVALID_PARAMS, 'Missing or invalid tool name');
        }
        if (typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
          return jsonRpcError(id, INVALID_PARAMS, 'Tool arguments must be an object');
        }

        console.log(`🔧 MCP Tool: ${toolName} | Args: ${JSON.stringify(toolArgs).substring(0, 100)}`);
        const result = await executeToolCall(toolName, toolArgs);
        return jsonRpcResponse(id, result);
      }

      // ── ping ──
      case 'ping':
        return jsonRpcResponse(id, {});

      // ── Unbekannte Methode ──
      default:
        // Alle notifications/* werden generisch als Notification akzeptiert (keine Response)
        if (method.startsWith('notifications/')) {
          return null;
        }
        return notification
          ? null
          : jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }

  } catch (err) {
    console.error(`❌ MCP Error in ${method}:`, err.message);
    return notification
      ? null
      : jsonRpcError(id, INTERNAL_ERROR, 'Internal server error');
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCorsHeaders(res);

  // ── OPTIONS (CORS Preflight) ──
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── HEAD (Liveness-Probe / Discovery ohne Body) ──
  // Manche MCP-Clients (u. a. python-httpx-basierte) schicken HEAD
  // vor dem eigentlichen POST, um zu prüfen ob der Endpoint lebt.
  // Muss laut HTTP-Spec die gleichen Header wie GET liefern, aber keinen Body.
  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).end();
  }

  // ── GET (Health Check / Server Discovery) ──
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      transport: 'streamable-http',
      server: MCP_SERVER_INFO.serverInfo,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
    });
  }

  // ── DELETE (Session Cleanup – stateless server, no-op) ──
  if (req.method === 'DELETE') {
    return res.status(200).json({ status: 'ok' });
  }

  // ── Nur POST ab hier ──
  if (req.method !== 'POST') {
    res.setHeader('Allow', ALLOWED_METHODS);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate Limiting ──
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp, 'mcp')) {
    console.warn(`⚠️ MCP Rate Limit: ${clientIp}`);
    return res.status(429).json(
      jsonRpcError(null, RATE_LIMIT_ERROR, 'Rate limit exceeded. Try again later.')
    );
  }

  // ── Body validieren ──
  const body = req.body;
  if (body === undefined || body === null) {
    return res.status(400).json(jsonRpcError(null, PARSE_ERROR, 'Parse error: empty body'));
  }
  if (typeof body !== 'object') {
    return res.status(400).json(jsonRpcError(null, PARSE_ERROR, 'Parse error: body not valid JSON'));
  }

  // ═══════════════════════════════════════════════════════════
  // BATCH-REQUEST (JSON-RPC 2.0 Array-Form)
  // ═══════════════════════════════════════════════════════════
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return res.status(400).json(
        jsonRpcError(null, INVALID_REQUEST, 'Empty batch not allowed')
      );
    }

    // Alle Messages parallel verarbeiten
    const responses = await Promise.all(
      body.map(msg => handleRpcMessage(msg, clientIp))
    );
    const validResponses = responses.filter(r => r !== null);

    // Spec: Wenn alle Messages Notifications waren → keine Response, 202
    if (validResponses.length === 0) {
      return res.status(202).end();
    }
    return res.status(200).json(validResponses);
  }

  // ═══════════════════════════════════════════════════════════
  // SINGLE MESSAGE
  // ═══════════════════════════════════════════════════════════
  // Notification? → 202 ohne Body (auch wenn sie intern verarbeitet wird)
  if (isNotification(body)) {
    // Fire-and-forget: interne Verarbeitung, aber Response verwerfen
    handleRpcMessage(body, clientIp).catch(err =>
      console.error('❌ Notification handler error:', err.message)
    );
    return res.status(202).end();
  }

  const response = await handleRpcMessage(body, clientIp);
  if (response === null) {
    // Defensive: handleRpcMessage hat null zurückgegeben obwohl id vorhanden war
    return res.status(202).end();
  }
  return res.status(200).json(response);
}
