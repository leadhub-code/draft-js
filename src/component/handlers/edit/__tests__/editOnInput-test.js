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
const EditorState = require('EditorState');

const onInput = require('editOnInput');

jest.mock('findAncestorOffsetKey', () => jest.fn(() => 'blockkey-0-0'));
jest.mock('keyCommandPlainBackspace', () => jest.fn(() => ({})));

const getEditorState = (text: string = '', key: string = 'blockkey') => {
  return EditorState.createWithContent(
    ContentState.createFromBlockArray([
      new ContentBlock({
        key,
        text,
      }),
    ]),
  );
};

function withGlobalGetSelectionAs(
  getSelectionValue:
    | $TEMPORARY$object<{...}>
    | $TEMPORARY$object<{anchorNode: Text}> = {},
  callback: () => void,
) {
  const oldGetSelection = global.getSelection;
  try {
    global.getSelection = () => getSelectionValue;
    callback();
  } finally {
    global.getSelection = oldGetSelection;
  }
}

test('restoreEditorDOM and keyCommandPlainBackspace are NOT called when the `inputType` is not from a backspace press', () => {
  const anchorNodeText = 'react draftjs';
  const globalSelection = {
    anchorNode: document.createTextNode(anchorNodeText),
  };
  withGlobalGetSelectionAs(globalSelection, () => {
    const editorState = getEditorState(anchorNodeText);
    const editorNode = document.createElement('div');
    const editor = {
      _latestEditorState: editorState,
      props: {},
      update: jest.fn(),
      restoreEditorDOM: jest.fn(),
      editor: editorNode,
    };

    const inputEvent = {
      nativeEvent: {inputType: 'insetText'},
      currentTarget: editorNode,
    };

    // $FlowExpectedError[incompatible-call]
    onInput(editor, inputEvent);

    expect(require('keyCommandPlainBackspace')).toHaveBeenCalledTimes(0);
    expect(editor.restoreEditorDOM).toHaveBeenCalledTimes(0);
    expect(editor.update).toHaveBeenCalledTimes(0);
  });
});

test('restoreEditorDOM and keyCommandPlainBackspace are called when backspace is pressed', () => {
  const anchorNodeText = 'react draftjs';
  const globalSelection = {
    anchorNode: document.createTextNode(anchorNodeText),
  };
  withGlobalGetSelectionAs(globalSelection, () => {
    const editorState = getEditorState(anchorNodeText);
    const editorNode = document.createElement('div');
    const editor = {
      _latestEditorState: editorState,
      props: {},
      update: jest.fn(),
      restoreEditorDOM: jest.fn(),
      editor: editorNode,
    };

    const inputEvent = {
      // When Backspace is pressed and input-type is supported, an event with
      // inputType === 'deleteContentBackward' is triggered by the browser.
      nativeEvent: {inputType: 'deleteContentBackward'},
      currentTarget: editorNode,
    };

    // $FlowExpectedError[incompatible-call]
    onInput(editor, inputEvent);

    // $FlowExpectedError[prop-missing]
    const newEditorState = require('keyCommandPlainBackspace').mock.results[0]
      .value;
    expect(require('keyCommandPlainBackspace')).toHaveBeenCalledWith(
      editorState,
    );
    expect(editor.restoreEditorDOM).toHaveBeenCalledTimes(1);
    expect(editor.update).toHaveBeenCalledWith(newEditorState);
  });
});

test('the event is ignored when the offset key names a block the content no longer has', () => {
  const anchorNodeText = 'react draftjs';
  const globalSelection = {
    anchorNode: document.createTextNode(anchorNodeText),
  };
  withGlobalGetSelectionAs(globalSelection, () => {
    // `findAncestorOffsetKey` reads the key off the DOM, so it can name a block
    // that is not in the current content -- e.g. when a browser extension
    // rewrites the contentEditable and fires a synthetic `input` event.
    const editorState = getEditorState(anchorNodeText, 'otherblockkey');
    const editorNode = document.createElement('div');
    const editor = {
      _latestEditorState: editorState,
      props: {},
      update: jest.fn(),
      restoreEditorDOM: jest.fn(),
      editor: editorNode,
    };

    const inputEvent = {
      nativeEvent: {inputType: 'insertText'},
      currentTarget: editorNode,
    };

    // $FlowExpectedError[incompatible-call]
    onInput(editor, inputEvent);

    expect(editor.update).toHaveBeenCalledTimes(0);
    expect(editor.restoreEditorDOM).toHaveBeenCalledTimes(0);
  });
});

test('the event is ignored when the offset key names a leaf the block tree no longer has', () => {
  const anchorNodeText = 'react draftjs';
  const globalSelection = {
    anchorNode: document.createTextNode(anchorNodeText),
  };
  withGlobalGetSelectionAs(globalSelection, () => {
    const editorState = getEditorState(anchorNodeText);
    const editorNode = document.createElement('div');
    const editor = {
      _latestEditorState: editorState,
      props: {},
      update: jest.fn(),
      restoreEditorDOM: jest.fn(),
      editor: editorNode,
    };

    // The block exists, but it has no leaf 5 in decorator range 0.
    require('findAncestorOffsetKey').mockReturnValueOnce('blockkey-0-5');

    const inputEvent = {
      nativeEvent: {inputType: 'insertText'},
      currentTarget: editorNode,
    };

    // $FlowExpectedError[incompatible-call]
    onInput(editor, inputEvent);

    expect(editor.update).toHaveBeenCalledTimes(0);
    expect(editor.restoreEditorDOM).toHaveBeenCalledTimes(0);
  });
});
