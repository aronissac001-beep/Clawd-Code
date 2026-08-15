"""Conversation management for Clawd Codex."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Union
from datetime import datetime


@dataclass
class TextContentBlock:
    """A text content block."""
    type: str = "text"
    text: str = ""


@dataclass
class ToolUseContentBlock:
    """A tool use content block."""
    type: str = "tool_use"
    id: str = ""
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResultContentBlock:
    """A tool result content block."""
    type: str = "tool_result"
    tool_use_id: str = ""
    content: Union[str, list[dict[str, Any]]] = ""
    is_error: bool = False


@dataclass
class ImageContentBlock:
    """An image attached to a message.

    ``url`` is either a ``data:`` URI or an https URL. It is emitted in OpenAI's
    ``image_url`` shape because that is what llama.cpp's server, OpenRouter and
    every OpenAI-compatible endpoint accept -- which is all of this project's
    hot paths. AnthropicProvider translates it to Anthropic's ``source`` shape
    on the way out, since it is the one provider that differs.
    """
    type: str = "image_url"
    url: str = ""
    detail: str = "auto"


ContentBlock = Union[
    TextContentBlock, ToolUseContentBlock, ToolResultContentBlock, ImageContentBlock
]


@dataclass
class Message:
    """Conversation message."""
    role: str  # "user", "assistant", "system"
    content: Union[str, list[ContentBlock]]
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    # Internal marker for messages that should be filtered from API (e.g., compact boundary)
    _is_internal: bool = field(default=False, repr=False)


@dataclass
class Conversation:
    """Conversation manager."""
    messages: list[Message] = field(default_factory=list)
    max_history: int = 100

    def add_message(self, role: str, content: Union[str, list[ContentBlock]]):
        """Add a message to conversation."""
        if len(self.messages) >= self.max_history:
            self.messages.pop(0)

        self.messages.append(Message(role=role, content=content))

    def add_user_message(self, text: str):
        """Add a plain user text message."""
        self.add_message("user", text)

    def add_user_message_with_images(self, text: str, image_urls: list[str]):
        """Add a user message carrying one or more images.

        Falls back to a plain text message when there are no images, so callers
        do not have to branch.
        """
        if not image_urls:
            self.add_message("user", text)
            return
        blocks: list[ContentBlock] = []
        if text:
            blocks.append(TextContentBlock(type="text", text=text))
        for url in image_urls:
            blocks.append(ImageContentBlock(type="image_url", url=url))
        self.add_message("user", blocks)

    def add_assistant_message(self, content: Union[str, list[ContentBlock]]):
        """Add an assistant message (text or tool use)."""
        self.add_message("assistant", content)

    def add_tool_result_message(self, tool_use_id: str, content: Union[str, list[dict]], is_error: bool = False):
        """Add a tool result message."""
        block = ToolResultContentBlock(
            type="tool_result",
            tool_use_id=tool_use_id,
            content=content,
            is_error=is_error
        )
        self.add_message("user", [block])

    def get_messages(self) -> list[dict]:
        """Get messages in API format (Anthropic style)."""
        api_messages = []
        for msg in self.messages:
            # Skip internal messages (e.g., compact boundary markers)
            if getattr(msg, "_is_internal", False):
                continue
            if isinstance(msg.content, str):
                api_messages.append({"role": msg.role, "content": msg.content})
            else:
                content_blocks = []
                for block in msg.content:
                    if isinstance(block, TextContentBlock):
                        content_blocks.append({"type": "text", "text": block.text})
                    elif isinstance(block, ToolUseContentBlock):
                        content_blocks.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input
                        })
                    elif isinstance(block, ToolResultContentBlock):
                        content_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": block.tool_use_id,
                            "content": block.content,
                            "is_error": block.is_error
                        })
                    elif isinstance(block, ImageContentBlock):
                        content_blocks.append({
                            "type": "image_url",
                            "image_url": {"url": block.url, "detail": block.detail},
                        })
                api_messages.append({"role": msg.role, "content": content_blocks})
        return api_messages

    def clear(self):
        """Clear conversation."""
        self.messages.clear()

    def to_dict(self) -> dict:
        """Serialize conversation."""
        messages_data = []
        for msg in self.messages:
            if isinstance(msg.content, str):
                content_data = msg.content
            else:
                content_data = []
                for block in msg.content:
                    if isinstance(block, TextContentBlock):
                        content_data.append({"type": "text", "text": block.text})
                    elif isinstance(block, ToolUseContentBlock):
                        content_data.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input
                        })
                    elif isinstance(block, ToolResultContentBlock):
                        content_data.append({
                            "type": "tool_result",
                            "tool_use_id": block.tool_use_id,
                            "content": block.content,
                            "is_error": block.is_error
                        })
                    elif isinstance(block, ImageContentBlock):
                        content_data.append({
                            "type": "image_url",
                            "url": block.url,
                            "detail": block.detail,
                        })
            messages_data.append({
                "role": msg.role,
                "content": content_data,
                "timestamp": msg.timestamp,
                "_is_internal": getattr(msg, "_is_internal", False),
            })
        return {
            "messages": messages_data,
            "max_history": self.max_history
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'Conversation':
        """Deserialize conversation."""
        conv = cls(max_history=data.get("max_history", 100))
        for msg_data in data.get("messages", []):
            content = msg_data["content"]
            if isinstance(content, str):
                msg_content = content
            else:
                msg_content = []
                for block_data in content:
                    block_type = block_data.get("type")
                    if block_type == "text":
                        msg_content.append(TextContentBlock(type="text", text=block_data.get("text", "")))
                    elif block_type == "tool_use":
                        msg_content.append(ToolUseContentBlock(
                            type="tool_use",
                            id=block_data.get("id", ""),
                            name=block_data.get("name", ""),
                            input=block_data.get("input", {})
                        ))
                    elif block_type == "tool_result":
                        msg_content.append(ToolResultContentBlock(
                            type="tool_result",
                            tool_use_id=block_data.get("tool_use_id", ""),
                            content=block_data.get("content", ""),
                            is_error=block_data.get("is_error", False)
                        ))
                    elif block_type == "image_url":
                        msg_content.append(ImageContentBlock(
                            type="image_url",
                            url=block_data.get("url", ""),
                            detail=block_data.get("detail", "auto"),
                        ))
            conv.messages.append(Message(
                role=msg_data["role"],
                content=msg_content,
                timestamp=msg_data.get("timestamp", ""),
                _is_internal=msg_data.get("_is_internal", False),
            ))
        return conv
