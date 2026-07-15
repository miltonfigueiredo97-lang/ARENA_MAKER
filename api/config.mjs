export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    githubImporterConfigured: Boolean(
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_PRIVATE_KEY &&
      process.env.GITHUB_INSTALLATION_ID &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO &&
      process.env.PUBLISH_SECRET
    )
  });
}
