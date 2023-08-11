const TYPE_CHANGE = "type-change";
const TYPE_REMOVE = "type-remove";
const POKEMON_SEARCH_QUERY = "pokemon-search-query";
const POKEMON_SEARCH_REMOVE = "pokemon-search-remove";
const POKEMON_CHANGE_SUGGESTION = "pokemon-change-suggestion";
const GET_POKEMON = "get-pokemon";
const GET_POKEMON_SUGGESTED = "get-pokemon-suggested";
const GET_POKEMON_RESULT = "get-pokemon-result";

const CHARS_IN_POKEMON_NAMES = "-2zyxwvutsrqponmlkjihgfedcba";
const ARROW_UP_CODE = "ArrowUp";
const ARROW_DOWN_CODE = "ArrowDown";
const ENTER_CODE = "Enter";
const BACKSPACE_CODE = "Backspace";

let typesRecord;
let typePublisher;
let pokemonTrie;
let pokemonPublisher;
let pokemonSuggestions;
let P;

document.addEventListener("DOMContentLoaded", async function () {
  P = new Pokedex.Pokedex();
  try {
    initTypes(P);
    initPokemon(P);
  } catch (e) {
    console.error(e);
  }
});

async function initTypes(P) {
  typePublisher = new Publisher();

  const typeLabel = new TypeLabel();
  typePublisher.subscribe("type-label", typeLabel);

  const damageClass = new DamageClass();
  typePublisher.subscribe("damage-class", damageClass);

  const response = await P.getTypes();
  const promises = response.results.map((baseType) => {
    return P.getType(baseType.name);
  });
  const pokemonTypes = (await Promise.allSettled(promises))
    .filter(({ status }) => status === "fulfilled")
    .map(({ value }) => value);

  typesRecord = pokemonTypes.reduce((record, pType) => {
    record[pType.name] = pType;
    return record;
  }, {});

  const selectElem = document.querySelector("#type-controller");
  for (const name of Object.keys(typesRecord)) {
    const pType = typesRecord[name];
    const controller = new PokemonTypeController(pType.name, pType);
    typePublisher.subscribe(name, controller);
    selectElem.append(controller.element());
  }

  const damages = document.querySelectorAll(".damage");
  for (const damage of damages) {
    const stat = new DamageStat(
      damage.dataset.effect,
      damage.dataset.direction,
    );
    const { effect, direction } = damage.dataset;
    typePublisher.subscribe(`${effect}-damage-${direction}`, stat);
  }
}

async function initPokemon(P) {
  const response = await P.getPokedexByName("national");
  pokemonTrie = new Trie("");
  response.pokemon_entries.forEach(({ pokemon_species }) => {
    pokemonTrie.insert(pokemon_species.name);
  });

  pokemonPublisher = new Publisher();

  const search = new PokemonSearch();
  pokemonPublisher.subscribe("pokemon-search", search);

  const suggestions = new PokemonSuggestionList();
  pokemonPublisher.subscribe("pokemon-suggestions", suggestions);
  pokemonSuggestions = suggestions;

  const pokemonTypeStat = new PokemonTypeStat();
  pokemonPublisher.subscribe("pokemon-type-stat", pokemonTypeStat);

  const pokemonDamages = document.querySelectorAll(".pokemon-damage");
  for (const damage of pokemonDamages) {
    let { effect, direction, type } = damage.dataset;
    const pokemonDamageStat = new PokemonDamageStat(effect, direction, type);
    if (type) {
      direction += "-" + type;
    }
    pokemonPublisher.subscribe(
      `${effect}-pokemon-damage-${direction}`,
      pokemonDamageStat,
    );
  }
  for (const x of [1, 2]) {
    const dealType = new PokemonDealType(x);
    pokemonPublisher.subscribe(`deal-type-${x}`, dealType);
  }
}

async function getPokemonTypes(name) {
  const pokemon = await P.getPokemonByName(name);

  // create mapping for pokemon type
  const from = {
    quadruple: [],
    double: [],
    half: [],
    quarter: [],
    no: [],
  };
  const toType1 = {
    double: [],
    half: [],
    no: [],
  };
  const toType2 = {
    double: [],
    half: [],
    no: [],
  };
  const damages = { from, toType1, toType2 };

  if (pokemon.types.length == 1) {
    // this is specific to pure pokemon
    const { damage_relations } = typesRecord[pokemon.types[0].type.name];

    damages.from.double = damage_relations.double_damage_from.map(
      ({ name }) => name,
    );
    damages.from.half = damage_relations.half_damage_from.map(
      ({ name }) => name,
    );
    damages.from.no = damage_relations.no_damage_from.map(({ name }) => name);

    damages.toType1.double = damage_relations.double_damage_to.map(
      ({ name }) => name,
    );
    damages.toType1.half = damage_relations.half_damage_to.map(
      ({ name }) => name,
    );
    damages.toType1.no = damage_relations.no_damage_to.map(({ name }) => name);
  } else if (pokemon.types.length == 2) {
    const { damage_relations: relA } = typesRecord[pokemon.types[0].type.name];
    const { damage_relations: relB } = typesRecord[pokemon.types[1].type.name];

    const doubleAFrom = new Set(
      relA.double_damage_from.map(({ name }) => name),
    );
    const halfAFrom = new Set(relA.half_damage_from.map(({ name }) => name));

    const doubleBFrom = new Set(
      relB.double_damage_from.map(({ name }) => name),
    );
    const halfBFrom = new Set(relB.half_damage_from.map(({ name }) => name));

    const noFrom = new Set([
      ...relA.no_damage_from.map(({ name }) => name),
      ...relB.no_damage_from.map(({ name }) => name),
    ]);

    for (const type of noFrom) {
      damages.from.no.push(type);
    }

    const doubleUnvisited = new Set(doubleBFrom);

    for (const type of doubleAFrom) {
      doubleUnvisited.delete(type);
      if (noFrom.has(type)) {
        /**
         * If the type of move is completely ineffective against one of the opponent's types,
         * then the move does no damage regardless of how the Pokémon’s other type would be
         * affected (as in an Electric-type move used against a Water/Ground Pokémon).
         **/
      } else if (halfBFrom.has(type)) {
        /**
         * If the type of a move is super effective against one of the
         * opponent's types but not very effective against the other
         * (such as a Grass-type move used against a Water/Flying
         * Pokémon), then the move deals regular damage.
         **/
      } else if (doubleBFrom.has(type)) {
        /**
         * If the type of a move is super effective against both of the opponent's types (such
         * as a Ground-type move used against a Steel/Rock Pokémon), then the move does 4 times
         * (250% in Legends: Arceus) the damage.
         **/
        damages.from.quadruple.push(type);
      } else {
        damages.from.double.push(type);
      }
    }

    for (const type of doubleUnvisited) {
      if (noFrom.has(type)) {
        /**
         * If the type of move is completely ineffective against one of the opponent's types,
         * then the move does no damage regardless of how the Pokémon’s other type would be
         * affected (as in an Electric-type move used against a Water/Ground Pokémon).
         **/
      } else if (halfAFrom.has(type)) {
        /**
         * If the type of a move is super effective against one of the
         * opponent's types but not very effective against the other
         * (such as a Grass-type move used against a Water/Flying
         * Pokémon), then the move deals regular damage.
         **/
      } else if (doubleAFrom.has(type)) {
        /**
         * If the type of a move is super effective against both of the opponent's types (such
         * as a Ground-type move used against a Steel/Rock Pokémon), then the move does 4 times
         * (250% in Legends: Arceus) the damage.
         **/
        damages.from.quadruple.push(type);
      } else {
        damages.from.double.push(type);
      }
    }

    /**
     * If the type of a move is not very effective against both of the opponent's types
     * (such as a Fighting-type move used against a Psychic/Flying Pokémon), then the move
     * only does ¼ (40% in Legends: Arceus) of the damage.
     **/
    for (const type of halfAFrom) {
      if (halfBFrom.has(type)) {
        damages.from.quarter.push(type);
      }
    }

    // Now we just handle all the to cases
    damages.toType1.double = relA.double_damage_to.map(({ name }) => name);
    damages.toType1.half = relA.half_damage_to.map(({ name }) => name);
    damages.toType1.no = relA.no_damage_to.map(({ name }) => name);

    damages.toType2.double = relB.double_damage_to.map(({ name }) => name);
    damages.toType2.half = relB.half_damage_to.map(({ name }) => name);
    damages.toType2.no = relB.no_damage_to.map(({ name }) => name);
  }

  pokemonPublisher.notify(GET_POKEMON_RESULT, {
    types: pokemon.types.map(({ type }) => type.name),
    damages,
  });
}

function getContrastYIQ(hexcolor) {
  var r = parseInt(hexcolor.substring(1, 3), 16);
  var g = parseInt(hexcolor.substring(3, 5), 16);
  var b = parseInt(hexcolor.substring(5, 7), 16);
  var yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "black" : "white";
}

class Publisher {
  constructor() {
    this.subscribers = {};
  }
  subscribe(id, subscriber) {
    if (typeof subscriber.update !== "function") {
      throw new Error("subscriber must have an update method");
    }
    this.subscribers[id] = subscriber;
  }
  unsubscribe(id) {
    delete this.subscribers[id];
  }
  notify(publisherEvent, payload) {
    for (const id of Object.keys(this.subscribers)) {
      const subscriber = this.subscribers[id];
      subscriber.update(publisherEvent, payload);
    }
  }
}

class Trie {
  constructor(char) {
    this.char = char.toLowerCase();
    this.children = {};
    this.isWord = false;
  }
  insert(word) {
    let curr = this;
    for (const letter of word) {
      if (!curr.children[letter]) {
        curr.children[letter] = new Trie(letter);
      }
      curr = curr.children[letter];
    }
    curr.isWord = true;
  }
  search(prefix, n) {
    const result = [];
    const stack = [];
    const prefixes = [prefix.slice(0, -1)];

    // make sure to search the correct sub-trie
    let root = this;
    for (const letter of prefix) {
      if (!root.children[letter]) {
        return [];
      }
      root = root.children[letter];
    }
    stack.push(root);

    while (result.length < n && stack.length > 0) {
      const curr = stack.pop();
      const prefix = prefixes.pop();
      if (curr.isWord) {
        result.push(prefix + curr.char);
      }

      for (const i of CHARS_IN_POKEMON_NAMES) {
        if (!curr.children[i]) {
          continue;
        }
        const child = curr.children[i];
        if (child) {
          stack.push(child);
          prefixes.push(prefix + curr.char);
        }
      }
    }
    return result;
  }
}

class PokemonTypeController {
  constructor(name, data) {
    this.name = name;
    this.data = data;
    this._element;
    this.init();
  }
  init() {
    const element = document.createElement("button");

    element.classList.add("border", "rounded");

    element.addEventListener("click", () => {
      typePublisher.notify(TYPE_CHANGE, this.name);
    });

    element.innerText = this.name;

    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  update(eventType, payload) {
    switch (eventType) {
      case TYPE_CHANGE:
        if (this.name == payload) {
          this.element().classList.add("bg-zinc-600");
        } else {
          this.element().classList.remove("bg-zinc-600");
        }
        break;
      case TYPE_REMOVE:
        this.element().classList.remove("bg-zinc-600");
        break;
    }
  }
}

class TypeLabel {
  element() {
    return document.querySelector("#type-label");
  }
  update(eventType, payload) {
    switch (eventType) {
      case TYPE_CHANGE:
        this.element().innerText = payload;
        break;
      case TYPE_REMOVE:
        this.element().innerText = "";
        break;
    }
  }
}
class DamageClass {
  constructor() {
    this._element;
  }
  element() {
    return document.querySelector("#damage-class");
  }
  update(eventType, payload) {
    switch (eventType) {
      case TYPE_CHANGE:
        const pType = typesRecord[payload];
        this.element().innerText = pType?.move_damage_class?.name ?? "N/A";
        break;
      case TYPE_REMOVE:
        this.element().innerText = "";
        break;
    }
  }
}

class DamageStat {
  constructor(effect, direction) {
    this.effect = effect;
    this.direction = direction;
  }
  element() {
    const { effect, direction } = this;
    return document.querySelector(`.damage.${effect}.${direction}`);
  }
  update(eventType, payload) {
    switch (eventType) {
      case TYPE_CHANGE:
        const pType = typesRecord[payload];
        const relations = pType?.damage_relations;
        const otherTypes = relations
          ? relations[`${this.effect}_damage_${this.direction}`] ?? []
          : [];
        this.element().innerText = otherTypes
          .map(({ name }) => name)
          .join(", ");
        break;
      case TYPE_REMOVE:
        this.element().innerText = "";
        break;
    }
  }
}

class PokemonSearch {
  /**
   * When the user begins typing characters, the menu options populate
   * 1. The first menu option should be selected
   * 2. If the user uses the up or down arrow keys this should focus the next option
   * 3. When the user presses "enter" then the search should know to select and search for the focused option
   **/
  constructor() {
    this._element;
    this.init();
  }
  init() {
    const element = document.querySelector("#pokemon-search");

    element.addEventListener("keyup", (e) => {
      if (!e.target.value) {
        pokemonPublisher.notify(POKEMON_SEARCH_REMOVE);
      } else if (e.code === ENTER_CODE) {
        pokemonPublisher.notify(GET_POKEMON_SUGGESTED);
      } else if (e.code === ARROW_UP_CODE || e.code === ARROW_DOWN_CODE) {
        pokemonPublisher.notify(POKEMON_CHANGE_SUGGESTION, e.code);
      } else {
        pokemonPublisher.notify(
          POKEMON_SEARCH_QUERY,
          typeof e.target.value === "string"
            ? e.target.value.toLowerCase()
            : "",
        );
      }
    });
    element.addEventListener("submit", (e) => {
      e.preventDefault();
    });

    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  update(publisherEvent, payload) {
    switch (publisherEvent) {
      case GET_POKEMON:
        const input = this.element().querySelector("#pokemon-search-input");
        input.value = payload;

        break;
      case POKEMON_SEARCH_REMOVE:
        this.element().value = "";
        break;
    }
  }
}

class PokemonSuggestionList {
  constructor() {
    this._element;
    this.suggestions = [];
    this.cursor = -1;
    this.init();
  }
  init() {
    const element = document.querySelector("#pokemon-suggestions");

    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  async update(publisherEvent, payload) {
    switch (publisherEvent) {
      case POKEMON_SEARCH_QUERY:
        while (this.element().hasChildNodes()) {
          this.element().removeChild(this.element().lastChild);
        }
        const names = pokemonTrie.search(payload, 20);
        this.suggestions = names;
        this.cursor = -1;
        if (names.length > 0) {
          this.cursor = 0;
        }
        let i = -1;
        for (const name of names) {
          i++;
          let select = false;
          if (this.cursor === i) {
            select = true;
          }
          const menuOption = new PokemonMenuOption(name, select);

          this.element().append(menuOption.element());
        }
        break;
      case GET_POKEMON:
      case POKEMON_SEARCH_REMOVE:
        while (this.element().hasChildNodes()) {
          this.element().removeChild(this.element().lastChild);
        }
        break;
      case GET_POKEMON_SUGGESTED:
        if (this.cursor == -1 || this.suggestions.length == 0) {
          break;
        }
        const suggestion = this.suggestions[this.cursor];
        pokemonPublisher.notify(GET_POKEMON, suggestion);
        await getPokemonTypes(suggestion);
        break;
      case POKEMON_CHANGE_SUGGESTION:
        switch (payload) {
          case ARROW_UP_CODE: {
            if (this.cursor <= 0) {
              break;
            }
            const child = this.element().children[this.cursor];
            const prev = this.element().children[this.cursor - 1];
            child.classList.remove("bg-zinc-600");
            child.classList.add("bg-zinc-900");
            prev.classList.remove("bg-zinc-900");
            prev.classList.add("bg-zinc-600");
            this.cursor--;
            break;
          }
          case ARROW_DOWN_CODE: {
            if (this.cursor >= this.suggestions.length - 1) {
              break;
            }
            const child = this.element().children[this.cursor];
            const next = this.element().children[this.cursor + 1];
            child.classList.remove("bg-zinc-600");
            child.classList.add("bg-zinc-900");
            next.classList.remove("bg-zinc-900");
            next.classList.add("bg-zinc-600");
            this.cursor++;
            break;
          }
        }
        break;
    }
  }
}

class PokemonMenuOption {
  constructor(name, selected = false) {
    this.name = name;
    this.selected = selected;
    this._element;
    this.init();
  }
  init() {
    const element = document.createElement("div");
    element.addEventListener("click", async (e) => {
      e.preventDefault();
      pokemonPublisher.notify(GET_POKEMON, this.name);
      await getPokemonTypes(this.name);
    });
    element.innerText = this.name;

    element.classList.add(
      "cursor-pointer",
      "p-2",
      "py-1",
      "border",
      "border-t-0",
      "border-zinc-600",
      "first:border-t",
      "last:mb-4",
    );

    if (this.selected) {
      element.classList.add("bg-zinc-600");
    } else {
      element.classList.add("bg-zinc-900");
    }

    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
}

class PokemonTypeStat {
  constructor() {
    this._element;
    this.init();
  }
  init() {
    const element = document.querySelector("#pokemon-type-stat");
    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  update(ev, payload) {
    switch (ev) {
      case GET_POKEMON_RESULT:
        this.element().innerText = payload.types.join(", ");
        break;
      case POKEMON_SEARCH_REMOVE:
        this.element().innerText = "";
        break;
    }
  }
}

class PokemonDamageStat {
  constructor(effect, direction, typeNo) {
    this._element;
    this.effect = effect;
    this.direction = direction;
    this.typeNo = typeNo;
    this.init();
  }
  init() {
    const { effect, direction, typeNo } = this;
    let selector = `.pokemon-damage.${effect}.${direction}`;
    if (typeNo) {
      selector += `[data-type="${typeNo}"]`;
    }

    const element = document.querySelector(selector);

    this._element = element;
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  update(ev, payload) {
    switch (ev) {
      case GET_POKEMON_RESULT:
        const { damages } = payload;
        let { effect, direction, typeNo } = this;
        if (direction == "to") {
          direction += "Type" + typeNo;
        }
        const arr = damages[direction][effect] ?? [];
        this.element().innerText = arr.join(", ");

        break;
      case POKEMON_SEARCH_REMOVE:
        this.element().innerText = "";
        break;
    }
  }
}

class PokemonDealType {
  constructor(typeNo) {
    this.typeNo = typeNo;
    this._element;
    this.init();
  }
  init() {
    this._element = document.querySelector(`#pokemon-type-${this.typeNo}-deal`);
    this._element.innerText = "type " + this.typeNo + " deals";
  }
  element() {
    if (!this._element) {
      throw new Error("run init function");
    }
    return this._element;
  }
  update(ev, payload) {
    switch (ev) {
      case GET_POKEMON_RESULT:
        this.element().innerText =
          (payload.types[this.typeNo - 1] ?? "") + " deals";
        break;
      case POKEMON_SEARCH_REMOVE:
        this.element().innerText = "type " + this.typeNo + " deals";
        break;
    }
  }
}
