# Code Style Guide

## Error Handling
- **Throw instead of returning errors** — no `| Error` return types
- Use try-catch at call sites, not wrapper functions like `safeParse`, `safeFetch`
- Early returns for error conditions

## Functions
- **Arrow functions** for all private/internal functions: `const fn = () => {}`
- `export const` for public functions
- Keep functions short and focused

## Syntax Preferences
- **Nullish coalescing** (`??`) over `|| defaultValue`
- **Optional chaining** (`?.`) over nested conditionals
- **Ternary** for simple conditional assignments
- **Truthy checks** (`if (value)`) instead of `if (value !== undefined)`
- Braces required for all blocks (no single-line if statements)

## Constants & Configuration
- Extract magic numbers to named constants at module top
- Group related constants in `as const` objects:
```typescript
const CONFIG = {
  timeout: 30000,
  maxRetries: 3,
} as const
```

## Data Transformation
- Prefer .filter().map() chains over imperative loops
- Use type guards in filter for proper typing: `.filter((x): x is ValidType => Boolean(x.required))`

## Code Organization
- Types/interfaces near the top, after imports
- Constants before functions
- Private helpers after public exports
- Extract complex logic into small named functions

## Naming
- Descriptive but concise
- No Hungarian notation or type prefixes
- Use camelCase for functions/variables, PascalCase for types

## Comments
- Minimal — code should be self-documenting
- JSDoc only for public API with @throws for functions that throw
- No obvious comments like `// increment counter`

## General
- No over-engineering — solve the current problem only
- Delete unused code completely, no `_unused` variables
- Compact object literals: `{ name, index, token }`
