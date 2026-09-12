function formatTime(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: "short",
        timeStyle: "medium",
      },
    ).format(new Date(value));
  } catch (_err) {
    return value;
  }
}

export function renderHistory(
  container,
  history,
) {
  container.replaceChildren();

  if (!history.length) {
    const empty = document.createElement(
      "div",
    );

    empty.className = "nc-card nc-empty";

    empty.innerHTML = `
      <h2>No activity yet</h2>
      <p>
        Notification activity and debug traces
        will appear here.
      </p>
    `;

    container.appendChild(
      empty,
    );

    return;
  }

  const list = document.createElement(
    "div",
  );

  list.className = "nc-card nc-history";

  for (const item of history) {
    const row = document.createElement(
      "div",
    );

    row.className = "nc-history-item";

    const time = document.createElement(
      "div",
    );

    time.className = "nc-history-time";
    time.textContent = formatTime(
      item.timestamp,
    );

    const type = document.createElement(
      "div",
    );

    type.className = "nc-history-type";
    type.textContent =
      `${item.alert_name} · ${item.type}`;

    const message = document.createElement(
      "div",
    );

    message.className =
      "nc-history-message";

    message.textContent =
      item.message || "";

    if (
      item.details &&
      Object.keys(item.details).length
    ) {
      const details =
        document.createElement(
          "div",
        );

      details.className =
        "nc-details";

      details.textContent =
        JSON.stringify(
          item.details,
          null,
          2,
        );

      message.appendChild(
        details,
      );
    }

    row.append(
      time,
      type,
      message,
    );

    list.appendChild(
      row,
    );
  }

  container.appendChild(
    list,
  );
}