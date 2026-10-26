"""Processor composition root: CLI parsing, route dispatch and error presentation."""
from .handler.commandSharedHandler import parse_args
from .models.processorInferencemodel import ProcessingError
from .routes.processorInferenceRoute import COMMANDS

def main() -> None:
    parser, args = parse_args()
    try:
        COMMANDS[args.command](args)
    except ValueError as error:
        parser.error(str(error))
    except ProcessingError as error:
        parser.exit(1, f'Processing failed: {error.code}\n')

if __name__ == '__main__':
    main()
