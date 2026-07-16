from pathlib import Path
import re

path = Path('server/nutritionRouter.test.ts')
text = path.read_text()

if 'toDateTimeLocalValueInTimeZone' not in text:
    text = text.replace(
        'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";\n',
        'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";\n'
        'import { DEFAULT_APP_TIME_ZONE, toDateTimeLocalValueInTimeZone } from "../shared/timeZone";\n',
        1,
    )

anchor = 'function createNutritionContext(userId: number, role: "user" | "admin" = "user"): TrpcContext {'
if 'function ownerDateTimeLocal(' not in text:
    helper = '''function ownerDateTimeLocal(value: string | number | Date) {
  return toDateTimeLocalValueInTimeZone(value, DEFAULT_APP_TIME_ZONE);
}

'''
    if anchor not in text:
        raise RuntimeError('nutrition router test helper anchor missing')
    text = text.replace(anchor, helper + anchor, 1)

def matching_paren(source: str, opening: int) -> int:
    depth = 0
    quote = None
    escaped = False
    for index in range(opening, len(source)):
        char = source[index]
        if quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ('"', "'", '`'):
            quote = char
            continue
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                return index
    raise RuntimeError('unbalanced call expression')

def replace_property(block: str, old_name: str, new_name: str) -> str:
    pattern = re.compile(r'\b' + re.escape(old_name) + r'\s*:')
    cursor = 0
    while True:
        match = pattern.search(block, cursor)
        if not match:
            return block
        value_start = match.end()
        while value_start < len(block) and block[value_start].isspace():
            value_start += 1
        index = value_start
        quote = None
        escaped = False
        paren = bracket = brace = 0
        while index < len(block):
            char = block[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == quote:
                    quote = None
                index += 1
                continue
            if char in ('"', "'", '`'):
                quote = char
            elif char == '(':
                paren += 1
            elif char == ')':
                if paren == 0:
                    break
                paren -= 1
            elif char == '[':
                bracket += 1
            elif char == ']':
                bracket -= 1
            elif char == '{':
                brace += 1
            elif char == '}':
                if brace == 0 and paren == 0 and bracket == 0:
                    break
                brace -= 1
            elif char == ',' and paren == 0 and bracket == 0 and brace == 0:
                break
            index += 1
        value = block[value_start:index].strip()
        if not value:
            raise RuntimeError(f'empty {old_name} value')
        replacement = f'{new_name}: ownerDateTimeLocal({value})'
        block = block[:match.start()] + replacement + block[index:]
        cursor = match.start() + len(replacement)

def rewrite_calls(source: str, marker: str, old_name: str, new_name: str) -> str:
    cursor = 0
    while True:
        start = source.find(marker, cursor)
        if start < 0:
            return source
        opening = source.find('(', start + len(marker) - 1)
        if opening < 0:
            raise RuntimeError(f'opening parenthesis missing for {marker}')
        closing = matching_paren(source, opening)
        block = replace_property(source[start:closing + 1], old_name, new_name)
        source = source[:start] + block + source[closing + 1:]
        cursor = start + len(block)

markers = [
    '.nutrition.meals.createManual(',
    '.nutrition.meals.update(',
    '.nutrition.meals.updateGroup(',
    '.nutrition.meals.copy(',
    '.nutrition.meals.copyGroup(',
    '.nutrition.meals.reuseFavorite(',
    '.nutrition.meals.confirm(',
    '.nutrition.exercises.create(',
    '.nutrition.exercises.update(',
    '.nutrition.water.create(',
]
for marker in markers:
    text = rewrite_calls(text, marker, 'occurredAt', 'dateTimeLocal')
text = rewrite_calls(text, '.nutrition.onboarding.complete(', 'weightMeasuredAt', 'weightMeasuredAtLocal')

remaining = []
for marker in markers:
    cursor = 0
    while True:
        start = text.find(marker, cursor)
        if start < 0:
            break
        opening = text.find('(', start + len(marker) - 1)
        closing = matching_paren(text, opening)
        block = text[start:closing + 1]
        if re.search(r'\boccurredAt\s*:', block):
            remaining.append(marker)
        cursor = closing + 1
if remaining:
    raise RuntimeError(f'legacy occurredAt remains in router tests: {remaining}')

path.write_text(text)
print('nutrition router tests migrated to dateTimeLocal')
