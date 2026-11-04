"""Small screen reader for Herdr's cursor-addressed PTY test output (not a terminal)."""
import re
import unicodedata

TOKEN = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]|[^\x1b]')


def screen(data, height=40, width=120):
    cells = [[' '] * width for _ in range(height)]
    row = col = 0
    saved = (0, 0)
    for token in TOKEN.findall(bytes(data).decode('utf-8', errors='replace')):
        if token.startswith('\x1b['):
            operation = token[-1]
            arguments = token[2:-1]
            if any(c not in '0123456789;' for c in arguments):
                continue
            args = [int(v or 0) for v in arguments.split(';')]
            n = args[0] or 1
            if operation in 'Hf': row, col = n - 1, (args[1] or 1) - 1 if len(args) > 1 else 0
            elif operation == 'A': row -= n
            elif operation == 'B': row += n
            elif operation == 'C': col += n
            elif operation == 'D': col -= n
            elif operation == 'G': col = n - 1
            elif operation == 'd': row = n - 1
            elif operation == 'J':
                for y in range(height):
                    for x in range(width):
                        if args[0] in (2, 3) or (args[0] == 0 and (y, x) >= (row, col)) or (args[0] == 1 and (y, x) <= (row, col)):
                            cells[y][x] = ' '
            elif operation == 'K' and 0 <= row < height:
                for x in range(width):
                    if args[0] == 2 or (args[0] == 0 and x >= col) or (args[0] == 1 and x <= col): cells[row][x] = ' '
        elif token == '\x1b7': saved = row, col
        elif token == '\x1b8': row, col = saved
        elif token.startswith('\x1b'): continue
        elif token == '\r': col = 0
        elif token == '\n': row += 1
        elif token == '\b': col = max(0, col - 1)
        elif token == '\t': col = (col // 8 + 1) * 8
        elif token.isprintable() and not unicodedata.combining(token):
            if 0 <= row < height and 0 <= col < width: cells[row][col] = token
            col += 2 if unicodedata.east_asian_width(token) in ('W', 'F') else 1
    return '\n'.join(''.join(line) for line in cells)
