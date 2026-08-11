/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @oncall draft_js
 */

'use strict';

import type {BlockMap} from 'BlockMap';
import type ContentState from 'ContentState';
import type {DraftBlockType} from 'DraftBlockType';
import type {DraftInlineStyle} from 'DraftInlineStyle';
import type {DraftRemovalDirection} from 'DraftRemovalDirection';
import type SelectionState from 'SelectionState';
import type {Map} from 'immutable';
import type {BlockDataMergeBehavior} from 'insertFragmentIntoContentState';

const CharacterMetadata = require('CharacterMetadata');
const ContentStateInlineStyle = require('ContentStateInlineStyle');

const applyEntityToContentState = require('applyEntityToContentState');
const getCharacterRemovalRange = require('getCharacterRemovalRange');
const getContentStateFragment = require('getContentStateFragment');
const Immutable = require('immutable');
const insertFragmentIntoContentState = require('insertFragmentIntoContentState');
const insertTextIntoContentState = require('insertTextIntoContentState');
const invariant = require('invariant');
const modifyBlockForContentState = require('modifyBlockForContentState');
const removeEntitiesAtEdges = require('removeEntitiesAtEdges');
const removeRangeFromContentState = require('removeRangeFromContentState');
const splitBlockInContentState = require('splitBlockInContentState');

const {OrderedSet} = Immutable;

/**
 * `DraftModifier` provides a set of convenience methods that apply
 * modifications to a `ContentState` object based on a target `SelectionState`.
 *
 * Any change to a `ContentState` should be decomposable into a series of
 * transaction functions that apply the required changes and return output
 * `ContentState` objects.
 *
 * These functions encapsulate some of the most common transaction sequences.
 */

/**
 * `moveText` removes the dragged range before inserting it at the drop point,
 * but the drop point was resolved against the *pre-removal* content. Removing a
 * range that spans several blocks collapses them all into the start block, so a
 * drop anywhere in the removed blocks names a key that no longer exists in the
 * block map -- `removeEntitiesAtEdges` then reads `getCharacterList()` off
 * `undefined`. Reconcile the target with the post-removal content first.
 *
 * Returns null when the drop landed inside the moved text, i.e. there is no
 * meaningful destination.
 */
function getTargetRangeAfterRemoval(
  afterRemoval: ContentState,
  removalRange: SelectionState,
  targetRange: SelectionState,
): ?SelectionState {
  const targetKey = targetRange.getStartKey();

  if (afterRemoval.getBlockForKey(targetKey) != null) {
    // The target block survived the removal; nothing to remap.
    return targetRange;
  }

  const startKey = removalRange.getStartKey();
  const startOffset = removalRange.getStartOffset();
  const endKey = removalRange.getEndKey();
  const endOffset = removalRange.getEndOffset();
  const targetOffset = targetRange.getStartOffset();

  if (targetKey === endKey && targetOffset >= endOffset) {
    // The tail of the end block was merged onto the end of the start block,
    // so the drop point moves with it.
    const mergedOffset = startOffset + (targetOffset - endOffset);
    return targetRange.merge({
      anchorKey: startKey,
      anchorOffset: mergedOffset,
      focusKey: startKey,
      focusOffset: mergedOffset,
      isBackward: false,
    });
  }

  return null;
}

const DraftModifier = {
  replaceText(
    contentState: ContentState,
    rangeToReplace: SelectionState,
    text: string,
    inlineStyle?: DraftInlineStyle,
    entityKey?: ?string,
  ): ContentState {
    const withoutEntities = removeEntitiesAtEdges(contentState, rangeToReplace);
    const withoutText = removeRangeFromContentState(
      withoutEntities,
      rangeToReplace,
    );

    const character = CharacterMetadata.create({
      style: inlineStyle || OrderedSet(),
      entity: entityKey || null,
    });

    return insertTextIntoContentState(
      withoutText,
      withoutText.getSelectionAfter(),
      text,
      character,
    );
  },

  insertText(
    contentState: ContentState,
    targetRange: SelectionState,
    text: string,
    inlineStyle?: DraftInlineStyle,
    entityKey?: ?string,
  ): ContentState {
    invariant(
      targetRange.isCollapsed(),
      'Target range must be collapsed for `insertText`.',
    );
    return DraftModifier.replaceText(
      contentState,
      targetRange,
      text,
      inlineStyle,
      entityKey,
    );
  },

  moveText(
    contentState: ContentState,
    removalRange: SelectionState,
    targetRange: SelectionState,
  ): ContentState {
    const movedFragment = getContentStateFragment(contentState, removalRange);

    const afterRemoval = DraftModifier.removeRange(
      contentState,
      removalRange,
      'backward',
    );

    const adjustedRange = getTargetRangeAfterRemoval(
      afterRemoval,
      removalRange,
      targetRange,
    );

    if (adjustedRange == null) {
      // The drop landed inside the text being moved, so there is nowhere to
      // move it to. Leave the content untouched rather than crashing.
      return contentState;
    }

    return DraftModifier.replaceWithFragment(
      afterRemoval,
      adjustedRange,
      movedFragment,
    );
  },

  replaceWithFragment(
    contentState: ContentState,
    targetRange: SelectionState,
    fragment: BlockMap,
    mergeBlockData?: BlockDataMergeBehavior = 'REPLACE_WITH_NEW_DATA',
  ): ContentState {
    const withoutEntities = removeEntitiesAtEdges(contentState, targetRange);
    const withoutText = removeRangeFromContentState(
      withoutEntities,
      targetRange,
    );

    return insertFragmentIntoContentState(
      withoutText,
      withoutText.getSelectionAfter(),
      fragment,
      mergeBlockData,
    );
  },

  removeRange(
    contentState: ContentState,
    rangeToRemove: SelectionState,
    removalDirection: DraftRemovalDirection,
  ): ContentState {
    let startKey, endKey, startBlock, endBlock;
    if (rangeToRemove.getIsBackward()) {
      rangeToRemove = rangeToRemove.merge({
        anchorKey: rangeToRemove.getFocusKey(),
        anchorOffset: rangeToRemove.getFocusOffset(),
        focusKey: rangeToRemove.getAnchorKey(),
        focusOffset: rangeToRemove.getAnchorOffset(),
        isBackward: false,
      });
    }
    startKey = rangeToRemove.getAnchorKey();
    endKey = rangeToRemove.getFocusKey();
    startBlock = contentState.getBlockForKey(startKey);
    endBlock = contentState.getBlockForKey(endKey);
    const startOffset = rangeToRemove.getStartOffset();
    const endOffset = rangeToRemove.getEndOffset();

    const startEntityKey = startBlock.getEntityAt(startOffset);
    const endEntityKey = endBlock.getEntityAt(endOffset - 1);

    // Check whether the selection state overlaps with a single entity.
    // If so, try to remove the appropriate substring of the entity text.
    if (startKey === endKey) {
      if (startEntityKey && startEntityKey === endEntityKey) {
        const adjustedRemovalRange = getCharacterRemovalRange(
          contentState.getEntityMap(),
          startBlock,
          endBlock,
          rangeToRemove,
          removalDirection,
        );
        return removeRangeFromContentState(contentState, adjustedRemovalRange);
      }
    }

    const withoutEntities = removeEntitiesAtEdges(contentState, rangeToRemove);
    return removeRangeFromContentState(withoutEntities, rangeToRemove);
  },

  splitBlock(
    contentState: ContentState,
    selectionState: SelectionState,
  ): ContentState {
    const withoutEntities = removeEntitiesAtEdges(contentState, selectionState);
    const withoutText = removeRangeFromContentState(
      withoutEntities,
      selectionState,
    );

    return splitBlockInContentState(
      withoutText,
      withoutText.getSelectionAfter(),
    );
  },

  applyInlineStyle(
    contentState: ContentState,
    selectionState: SelectionState,
    inlineStyle: string,
  ): ContentState {
    return ContentStateInlineStyle.add(
      contentState,
      selectionState,
      inlineStyle,
    );
  },

  removeInlineStyle(
    contentState: ContentState,
    selectionState: SelectionState,
    inlineStyle: string,
  ): ContentState {
    return ContentStateInlineStyle.remove(
      contentState,
      selectionState,
      inlineStyle,
    );
  },

  setBlockType(
    contentState: ContentState,
    selectionState: SelectionState,
    blockType: DraftBlockType,
  ): ContentState {
    return modifyBlockForContentState(contentState, selectionState, block =>
      block.merge({type: blockType, depth: 0}),
    );
  },

  setBlockData(
    contentState: ContentState,
    selectionState: SelectionState,
    blockData: Map<any, any>,
  ): ContentState {
    return modifyBlockForContentState(contentState, selectionState, block =>
      block.merge({data: blockData}),
    );
  },

  mergeBlockData(
    contentState: ContentState,
    selectionState: SelectionState,
    blockData: Map<any, any>,
  ): ContentState {
    return modifyBlockForContentState(contentState, selectionState, block =>
      block.merge({data: block.getData().merge(blockData)}),
    );
  },

  applyEntity(
    contentState: ContentState,
    selectionState: SelectionState,
    entityKey: ?string,
  ): ContentState {
    const withoutEntities = removeEntitiesAtEdges(contentState, selectionState);
    return applyEntityToContentState(
      withoutEntities,
      selectionState,
      entityKey,
    );
  },
};

module.exports = DraftModifier;
