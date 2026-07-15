import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { createClient } from '@supabase/supabase-js';

const API_VERSION = '2022-11-28';
const MAX_FILES = 400;
const MAX_DECODED_BYTES = 3_000_000;
const PROTECTED_PREFIXES = ['.github/workflows/'];
const BLOCKED_SEGMENTS = ['.git/', 'node_modules/'];

function parseBody(request) {
  if (typeof request.body === 'string') return JSON.parse(request.body);
  return request.body || {};
}

function validPath(path) {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) return false;
  if (PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (BLOCKED_SEGMENTS.some((segment) => path.includes(segment))) return false;
  if (path === '.env' || path.endsWith('/.env')) return false;
  return true;
}

async function authorize(request) {
  const authHeader = request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw Object.assign(new Error('Sessão do Supabase ausente.'), { statusCode: 401 });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase do servidor não configurado.');

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error('Sessão inválida.'), { statusCode: 401 });

  const allowedEmails = String(process.env.IMPORTER_ALLOWED_EMAILS || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (allowedEmails.length && !allowedEmails.includes(String(data.user.email || '').toLowerCase())) {
    throw Object.assign(new Error('Seu e-mail não tem permissão para publicar.'), { statusCode: 403 });
  }
  return data.user;
}

async function githubClient() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = String(process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const installationId = process.env.GITHUB_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) throw new Error('GitHub App não configurada.');

  const auth = createAppAuth({ appId, privateKey, installationId });
  const installation = await auth({ type: 'installation' });
  return new Octokit({ auth: installation.token });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método não permitido.' });

  try {
    const user = await authorize(request);
    const body = parseBody(request);
    const files = Array.isArray(body.files) ? body.files : [];
    const replace = Boolean(body.replace);
    const message = String(body.message || 'Atualização via Arena Maker').slice(0, 180);

    if (!files.length) return response.status(400).json({ error: 'Nenhum arquivo recebido.' });
    if (files.length > MAX_FILES) return response.status(400).json({ error: `Máximo de ${MAX_FILES} arquivos por publicação.` });

    let decodedBytes = 0;
    const sanitizedFiles = files.map((file) => {
      const path = String(file.path || '').replace(/^\/+/, '');
      if (!validPath(path)) throw Object.assign(new Error(`Caminho bloqueado: ${path || '(vazio)'}`), { statusCode: 400 });
      const content = String(file.content || '');
      decodedBytes += Buffer.byteLength(content, 'base64');
      return { path, content };
    });
    if (decodedBytes > MAX_DECODED_BYTES) return response.status(413).json({ error: 'O ZIP extraído excede 3 MB nesta versão.' });

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!owner || !repo) throw new Error('Repositório do GitHub não configurado.');

    const octokit = await githubClient();
    const headers = { 'X-GitHub-Api-Version': API_VERSION };
    const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}`, headers });
    const parentSha = ref.data.object.sha;
    const parentCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha, headers });
    const baseTreeSha = parentCommit.data.tree.sha;

    const blobs = await Promise.all(sanitizedFiles.map(async (file) => {
      const blob = await octokit.rest.git.createBlob({ owner, repo, content: file.content, encoding: 'base64', headers });
      return { path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha };
    }));

    const treeEntries = [...blobs];
    if (replace) {
      const currentTree = await octokit.rest.git.getTree({ owner, repo, tree_sha: baseTreeSha, recursive: '1', headers });
      const uploaded = new Set(sanitizedFiles.map((file) => file.path));
      for (const item of currentTree.data.tree || []) {
        if (item.type !== 'blob' || !item.path || uploaded.has(item.path)) continue;
        if (PROTECTED_PREFIXES.some((prefix) => item.path.startsWith(prefix))) continue;
        treeEntries.push({ path: item.path, mode: item.mode || '100644', type: 'blob', sha: null });
      }
    }

    const tree = await octokit.rest.git.createTree({ owner, repo, base_tree: baseTreeSha, tree: treeEntries, headers });
    const commit = await octokit.rest.git.createCommit({
      owner, repo, message, tree: tree.data.sha, parents: [parentSha],
      author: { name: user.user_metadata?.full_name || user.email || 'Arena Maker', email: user.email || 'arena-maker@users.noreply.github.com', date: new Date().toISOString() },
      headers
    });
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false, headers });

    return response.status(200).json({
      ok: true,
      branch,
      commitSha: commit.data.sha,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.data.sha}`,
      files: sanitizedFiles.length
    });
  } catch (error) {
    console.error(error);
    return response.status(error.statusCode || 500).json({ error: error.message || 'Falha interna ao publicar.' });
  }
}
