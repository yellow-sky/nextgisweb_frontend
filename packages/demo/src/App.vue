<template>
  <v-app id="inspire">
    <v-navigation-drawer
      :clipped="$vuetify.breakpoint.lgAndUp"
      :open="open"
      v-model="drawer"
      fixed
      app
    >
    <v-treeview v-if="items" v-model="tree"
      :active.sync="active"
      :items="items"
      :open="open"
      activatable
      open-on-click
      transition
    >
      <template slot="prepend" slot-scope="{ item, open, leaf }">
        <v-icon v-if="item.icon">
          {{item.icon}}
        </v-icon>
      </template>
    </v-treeview>
    </v-navigation-drawer>
    <v-toolbar
      :clipped-left="$vuetify.breakpoint.lgAndUp"
      color="white"
      app
      fixed
    >
      <v-toolbar-title class="ml-0 pl-0">
        <v-toolbar-side-icon @click.stop="drawer = !drawer"></v-toolbar-side-icon>
        <span class="">NextGIS Frontend</span>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn icon large href="https://github.com/nextgis/nextgisweb_frontend" target="_blank">
        <v-icon large>mdi-github-circle</v-icon>
      </v-btn>

    </v-toolbar>
    <v-content>
      <component
        v-if="current"
        v-bind:is="current.component"
        :text="current.name"
        :description="current.description"
        :html="current.html"
      >
      </component>
    </v-content>


  </v-app>
</template>

<script lang="ts">
export { App as default } from './App';
</script>


<style lang="scss">
* {
  padding: 0;
  margin: 0;
}

html,
body {
  width: 100%;
  height: 100%;
}

code:after,
kbd:after,
code:before,
kbd:before {
  content: "" !important;
  letter-spacing: 0 !important;
}
</style>
