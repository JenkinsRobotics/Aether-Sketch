// Shared UI ships CSS beside its JavaScript; inlining lets Vite handle those imports in component tests.
export default { test: { include: ['src/**/*.test.{ts,tsx}'], server: { deps: { inline: [/@aether\/ui/] } } } };
