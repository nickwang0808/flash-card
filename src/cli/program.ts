import { Command, Option } from 'commander';

type CommandHandler = (operation: string, options: Record<string, unknown>) => Promise<void>;

function addInput(command: Command): Command {
  return command.addOption(new Option('--input <path>', 'JSON input file, or - for stdin'));
}

function addQueue(command: Command): Command {
  return command.option('--limit <number>', 'queue limit');
}

function addPagination(command: Command): Command {
  return command.option('--cursor <cursor>', 'opaque pagination cursor').option('--limit <number>', 'page size');
}

function addCardContent(command: Command): Command {
  return command
    .option('--deck-id <uuid>')
    .option('--name <name>')
    .option('--front-markdown <markdown>')
    .option('--back-markdown <markdown>')
    .option('--tag <tag>', 'card tag', collect, [])
    .option('--speech-text <text>')
    .option('--speech-locale <locale>')
    .option('--speech-side <front|back>')
    .option('--reversible');
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function invoke(handler: CommandHandler, operation: string) {
  return async (options: Record<string, unknown>) => handler(operation, options);
}

export function createProgram(handler: CommandHandler, writeOut: (text: string) => void): Command {
  const program = new Command();
  program
    .name('flashcard')
    .description('One-shot Flashcard API client')
    .version('0.1.0')
    .showSuggestionAfterError(false)
    .showHelpAfterError(false)
    .configureOutput({ writeOut, writeErr: () => undefined });

  const auth = program.command('auth').description('Manage local authentication');
  auth.command('login').option('--no-open', 'print the authorization URL instead of opening a browser').option('--credential-store <keyring|file>').action(invoke(handler, 'auth.login'));
  auth.command('session').action(invoke(handler, 'auth.session'));
  auth.command('logout').action(invoke(handler, 'auth.logout'));

  const deck = program.command('deck').description('Manage decks');
  deck.command('list').action(invoke(handler, 'deck.list'));
  addInput(deck.command('create').option('--name <name>').option('--default-speech-locale <locale>')).action(invoke(handler, 'deck.create'));
  addInput(deck.command('rename').option('--deck-id <uuid>').option('--name <name>').option('--expected-version <version>')).action(invoke(handler, 'deck.rename'));
  addInput(deck.command('remove').option('--deck-id <uuid>').option('--expected-version <version>').option('--yes')).action(invoke(handler, 'deck.remove'));
  addInput(addQueue(deck.command('queue').option('--deck-id <uuid>'))).action(invoke(handler, 'deck.queue'));

  const card = program.command('card').description('Manage cards');
  addInput(card.command('get').option('--card-id <uuid>').option('--deck-id <uuid>')).action(invoke(handler, 'card.get'));
  addInput(addPagination(card.command('search').option('--query <query>').option('--deck-id <uuid>'))).action(invoke(handler, 'card.search'));
  addInput(addCardContent(card.command('create'))).action(invoke(handler, 'card.create'));
  addInput(card.command('import')).action(invoke(handler, 'card.import'));
  addInput(addCardContent(card.command('update').option('--card-id <uuid>').option('--expected-version <version>'))).action(invoke(handler, 'card.update'));
  for (const name of ['suspend', 'restore'] as const) addInput(addQueue(card.command(name).option('--card-id <uuid>').option('--deck-id <uuid>').option('--expected-version <version>'))).action(invoke(handler, `card.${name}`));
  addInput(addQueue(card.command('remove').option('--card-id <uuid>').option('--deck-id <uuid>').option('--expected-version <version>').option('--yes'))).action(invoke(handler, 'card.remove'));
  addInput(addPagination(card.command('revisions').option('--card-id <uuid>').option('--deck-id <uuid>'))).action(invoke(handler, 'card.revisions'));
  addInput(card.command('rollback').option('--card-id <uuid>').option('--deck-id <uuid>').option('--revision-id <uuid>').option('--expected-version <version>')).action(invoke(handler, 'card.rollback'));

  const review = program.command('review').description('Record and inspect reviews');
  addInput(addQueue(review.command('rate').option('--cadence-id <uuid>').option('--deck-id <uuid>').option('--rating <again|hard|good|easy>').option('--expected-version <version>').option('--request-id <uuid>'))).action(invoke(handler, 'review.rate'));
  addInput(addPagination(review.command('history').option('--cadence-id <uuid>').option('--deck-id <uuid>'))).action(invoke(handler, 'review.history'));
  addInput(addQueue(review.command('undo').option('--review-id <uuid>').option('--deck-id <uuid>'))).action(invoke(handler, 'review.undo'));
  return program;
}
