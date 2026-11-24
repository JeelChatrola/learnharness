import marimo

app = marimo.App()


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.cell
def _(mo):
    x = mo.ui.slider(-10, 10, value=3, show_value=True, label="x")
    x
    return (x,)


@app.cell
def _(mo, x):
    from learnharness_notebook import publish

    publish({"x": x.value, "square": x.value ** 2})
    mo.md(f"**{x.value} squared is {x.value ** 2}.**")
    return


if __name__ == "__main__":
    app.run()
