/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @oncall draft_js
 */

'use strict';

const ContentBlock = require('ContentBlock');
const ContentState = require('ContentState');
const DraftModifier = require('DraftModifier');
const SelectionState = require('SelectionState');

const getContentState = () =>
  ContentState.createFromBlockArray([
    new ContentBlock({key: 'a', type: 'unstyled', text: 'Alpha'}),
    new ContentBlock({key: 'b', type: 'unstyled', text: 'Bravo'}),
    new ContentBlock({key: 'c', type: 'unstyled', text: 'Charlie'}),
  ]);

const getSelection = (
  anchorKey: string,
  anchorOffset: number,
  focusKey: string,
  focusOffset: number,
  isBackward: boolean = false,
) =>
  new SelectionState({
    anchorKey,
    anchorOffset,
    focusKey,
    focusOffset,
    isBackward,
    hasFocus: true,
  });

const getBlockTexts = (contentState: ContentState) =>
  contentState
    .getBlockMap()
    .toArray()
    .map(block => block.getText());

describe('moveText', () => {
  it('moves text when the target block is untouched by the removal', () => {
    // Drag "Alp" out of the first block and drop it inside the last one. The
    // removal only shortens block `a`, so every block key survives.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 0, 'a', 3),
      getSelection('c', 3, 'c', 3),
    );

    expect(getBlockTexts(result)).toEqual(['ha', 'Bravo', 'ChaAlprlie']);
  });

  it('remaps the target when the removal collapses it into the start block', () => {
    // Drag from the middle of `a` to the middle of `c`. That removal merges the
    // tail of `c` onto `a` and deletes both `b` and `c`, so the drop point --
    // resolved against the pre-removal content -- names a block that is gone.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'c', 2),
      getSelection('c', 3, 'c', 3),
    );

    // Post-removal the content is the single block "Alarlie"; the drop at `c`:3
    // maps to offset 2 + (3 - 2) = 3, i.e. between "Ala" and "rlie".
    expect(getBlockTexts(result)).toEqual(['Alapha', 'Bravo', 'Chrlie']);
  });

  it('remaps a target sitting exactly at the end of the removal range', () => {
    // `targetOffset === endOffset` is the boundary of the remap: dropping right
    // where the dragged text ended must put it back where it came from.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'c', 2),
      getSelection('c', 2, 'c', 2),
    );

    expect(getBlockTexts(result)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('remaps the target for a backward removal range', () => {
    // Dragging right-to-left produces a backward selection; the remap has to
    // read start/end rather than anchor/focus.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('c', 2, 'a', 2, true),
      getSelection('c', 3, 'c', 3),
    );

    expect(getBlockTexts(result)).toEqual(['Alapha', 'Bravo', 'Chrlie']);
  });

  it('leaves the content untouched when the drop lands inside the moved text', () => {
    // Block `b` is removed wholesale, so there is no meaningful destination.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'c', 2),
      getSelection('b', 2, 'b', 2),
    );

    expect(result).toBe(contentState);
  });

  it('leaves the content untouched when the drop lands in the end block before the range ends', () => {
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'c', 4),
      getSelection('c', 1, 'c', 1),
    );

    expect(result).toBe(contentState);
  });

  it('leaves the content untouched when the drop lands inside the moved text in a surviving block', () => {
    // The start block always survives, so a drop past `startOffset` names an
    // offset whose characters were just removed.
    const contentState = getContentState();
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'b', 3),
      getSelection('a', 4, 'a', 4),
    );

    expect(result).toBe(contentState);
  });

  it('leaves the content untouched when a single-block drop lands inside the moved text', () => {
    const contentState = ContentState.createFromBlockArray([
      new ContentBlock({key: 'a', type: 'unstyled', text: 'hello world'}),
    ]);
    const result = DraftModifier.moveText(
      contentState,
      getSelection('a', 2, 'a', 8),
      getSelection('a', 5, 'a', 5),
    );

    expect(result).toBe(contentState);
  });

  describe('when the drop target is not collapsed', () => {
    // `getUpdatedSelectionState` returns the current selection when it cannot
    // resolve the drop coordinates against the block tree, so during an
    // internal drag `moveText` can be handed the dragged range as its target.
    it('drops at the start of the range rather than reading a removed block', () => {
      const contentState = getContentState();
      const range = getSelection('a', 2, 'c', 2);
      const result = DraftModifier.moveText(contentState, range, range);

      expect(getBlockTexts(result)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('drops at the start of the range rather than dropping text', () => {
      const contentState = ContentState.createFromBlockArray([
        new ContentBlock({key: 'a', type: 'unstyled', text: 'hello world'}),
      ]);
      const range = getSelection('a', 2, 'a', 8);
      const result = DraftModifier.moveText(contentState, range, range);

      expect(getBlockTexts(result)).toEqual(['hello world']);
    });
  });
});
