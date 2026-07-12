/**
 * shop_boon_cache.js — in-memory boon registry for open_shop.
 *
 * Dialog and other non-region sources pass the boon object directly.
 * Region shops fall back to fromUuid(shop_id) when not cached.
 */

/** @type {Map<string, { boon: object, persist_boon?: Function }>} */
const cache = new Map();

function cache_shop_boon(shop_id, boon, persist_boon = null) {
  if (!shop_id || !boon) return;
  cache.set(shop_id, {
    boon: foundry.utils.deepClone(boon),
    persist_boon: persist_boon || null,
  });
}

function get_cached_boon_entry(shop_id) {
  return cache.get(shop_id) || null;
}

function find_boon_in_dialog_trees(shop_id) {
  const trees = game.settings.get("dc-npc-patrols", "dialog_trees");
  if (!trees) return null;

  for (const tree of Object.values(trees)) {
    for (const node of Object.values(tree.nodes || {})) {
      for (const response of node.responses || []) {
        for (const boon of response.boons || []) {
          if (boon.type === "open_shop" && boon.shop_id === shop_id) {
            return foundry.utils.deepClone(boon);
          }
        }
      }
    }
  }
  return null;
}

async function update_dialog_tree_boon(shop_id, update_fn) {
  const trees = foundry.utils.deepClone(
    game.settings.get("dc-npc-patrols", "dialog_trees") || {}
  );
  if (!Object.keys(trees).length) return false;

  for (const tree of Object.values(trees)) {
    for (const node of Object.values(tree.nodes || {})) {
      for (const response of node.responses || []) {
        for (const boon of response.boons || []) {
          if (boon.type === "open_shop" && boon.shop_id === shop_id) {
            update_fn(boon);
            await game.settings.set("dc-npc-patrols", "dialog_trees", trees);
            const entry = cache.get(shop_id);
            if (entry?.boon) {
              Object.assign(entry.boon, boon);
            }
            return true;
          }
        }
      }
    }
  }
  return false;
}

async function resolve_shop_boon(shop_id) {
  if (!shop_id) return null;

  const entry = cache.get(shop_id);
  if (entry?.boon) {
    return {
      boon: entry.boon,
      source: entry.persist_boon ? "dialog" : "cache",
      persist_boon: entry.persist_boon,
      behavior: null,
    };
  }

  const dialog_boon = find_boon_in_dialog_trees(shop_id);
  if (dialog_boon) {
    return { boon: dialog_boon, source: "dialog", persist_boon: null, behavior: null };
  }

  const behavior = await fromUuid(shop_id);
  if (!behavior) return null;

  const boons = foundry.utils.getProperty(behavior, "system.boons") || [];
  const boon = boons.find(b => b.type === "open_shop");
  if (!boon) return null;

  return { boon, source: "region", persist_boon: null, behavior };
}

async function update_shop_boon(shop_id, update_fn) {
  const entry = cache.get(shop_id);
  if (entry?.boon) {
    update_fn(entry.boon);
    if (entry.persist_boon) {
      await entry.persist_boon(shop_id, foundry.utils.deepClone(entry.boon));
    } else if (find_boon_in_dialog_trees(shop_id)) {
      await update_dialog_tree_boon(shop_id, (b) => {
        Object.assign(b, foundry.utils.deepClone(entry.boon));
      });
    }
    return true;
  }

  if (await update_dialog_tree_boon(shop_id, update_fn)) {
    return true;
  }

  const behavior = await fromUuid(shop_id);
  if (!behavior) return false;

  const boons = foundry.utils.deepClone(
    foundry.utils.getProperty(behavior, "system.boons") || []
  );
  const boon = boons.find(b => b.type === "open_shop");
  if (!boon) return false;

  update_fn(boon);
  const idx = boons.indexOf(boon);
  boons[idx] = boon;
  await behavior.update({ "system.boons": boons });
  return true;
}

export {
  cache_shop_boon,
  get_cached_boon_entry,
  resolve_shop_boon,
  update_shop_boon,
};
