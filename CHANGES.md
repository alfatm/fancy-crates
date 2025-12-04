# Recent Changes - Programmatic API & JSON Output

## Added Features

### 1. Programmatic API (`src/api/index.ts`)

Новый модуль API для программного использования fancy-crates:

- **`validateCrate(filePath, options?)`** - Анализ одного Cargo.toml файла
- **`validateBatch(options)`** - Массовый анализ всех Cargo.toml в директории
- **`toJson(result)`** - Конвертация результата в JSON
- **`toJsonWithSummary(result)`** - Конвертация с суммарной статистикой
- **`exportBatchToJson(result, pretty?)`** - Экспорт массового анализа в JSON

### 2. Улучшенный JSON Output в CLI

CLI теперь использует улучшенный формат JSON с:
- Структурированными данными о зависимостях
- Суммарной статистикой (latest, patch-behind, minor-behind, major-behind, errors)
- Нормализованными версиями (строки вместо объектов SemVer)
- Информацией о источнике зависимости (registry, path, git)

Использование:
```bash
fancy-crates-cli ./Cargo.toml --json > output.json
```

### 3. Примеры использования (`examples/`)

Готовые к использованию примеры:

- **`single-crate.ts`** - Анализ одного крейта с детальной статистикой
- **`batch-analysis.ts`** - Массовый анализ workspace с генерацией отчета
- **`custom-registry.ts`** - Работа с приватными/кастомными регистрами
- **`security-audit.ts`** - Аудит безопасности для CI/CD

Запуск:
```bash
pnpm run build
node dist/examples/single-crate.cjs ./Cargo.toml
node dist/examples/batch-analysis.cjs ./workspace
```

### 4. Документация

- **`API.md`** - Полная документация по программному API
- **`README.md`** - Обновлен с информацией об API и примерах

## Use Cases

### CI/CD Integration
```typescript
import { validateBatch } from 'fancy-crates/api'

const result = await validateBatch({ rootDir: '.' })
if (result.summary.majorBehind > 0) {
  console.error(`${result.summary.majorBehind} dependencies need major updates`)
  process.exit(1)
}
```

### Workspace Analysis
```typescript
import { validateBatch, exportBatchToJson } from 'fancy-crates/api'
import { writeFile } from 'fs/promises'

const result = await validateBatch({
  rootDir: './my-workspace',
  concurrency: 5
})

await writeFile('report.json', exportBatchToJson(result))
```

### Custom Filtering
```typescript
import { validateCrate } from 'fancy-crates/api'

const result = await validateCrate('./Cargo.toml')
const outdated = result.dependencies.filter(
  d => d.status === 'major-behind'
)
```

## Technical Details

### JSON Output Format

```typescript
interface ValidationResultJson {
  filePath: string
  dependencies: DependencyResultJson[]
  parseError?: string
  summary: {
    total: number
    latest: number
    patchBehind: number
    minorBehind: number
    majorBehind: number
    errors: number
  }
}

interface DependencyResultJson {
  name: string
  currentVersion?: string
  resolvedVersion?: string
  latestStable?: string
  latest?: string
  locked?: string
  registry?: string
  status: string
  error?: string
  line: number
  source: {
    type: string
    [key: string]: unknown
  }
}
```

### Batch Analysis Features

- Configurable concurrency for parallel processing
- Automatic Cargo.toml discovery (recursive directory search)
- Error handling per file (failures don't stop the batch)
- Aggregated statistics across all crates
- Support for custom registries and authentication

## Files Changed/Added

### New Files
- `src/api/index.ts` - Programmatic API module
- `examples/single-crate.ts` - Single crate example
- `examples/batch-analysis.ts` - Batch analysis example
- `examples/custom-registry.ts` - Custom registry example
- `examples/security-audit.ts` - Security audit example
- `API.md` - API documentation

### Modified Files
- `src/cli/index.ts` - Updated to use new JSON formatter
- `vite.config.ts` - Added example builds
- `README.md` - Added API documentation section

## Breaking Changes

None. All changes are additive.

## Next Steps

Suggested improvements:
1. Add package.json exports for `fancy-crates/api`
2. Consider publishing as npm package for programmatic use
3. Add more filtering/querying options to the API
4. Add watch mode for continuous monitoring
5. Add update automation (auto-update dependencies)
